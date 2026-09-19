/**
 * Liquid Glass native addon (macOS).
 *
 * Exposes Apple's NSGlassEffectView (macOS 26+, looked up dynamically so the
 * addon also builds and loads on older systems) to VSCode's Electron main
 * process. The view is inserted UNDERNEATH Chromium's content view, so the
 * window must be transparent (backgroundColor '#00000000') for the glass to
 * show through. Never combine this with BrowserWindow.setVibrancy() — Electron
 * installs its own NSVisualEffectView that hides the glass.
 *
 * The handle passed from JS is BrowserWindow.getNativeWindowHandle(): a Buffer
 * whose first bytes are the pointer to the Cocoa NSView backing the window.
 *
 * Adapted from electron-liquid-glass (MIT, Meridius Labs), vendored here so
 * the extension stays self-contained. NSGlassEffectView and its variant /
 * scrim / subdued setters are private API — inherently brittle across macOS
 * releases, everything is done via NSClassFromString + respondsToSelector.
 *
 * JS API (class LiquidGlassNative):
 *   addView(handle: Buffer, { cornerRadius?, tintColor?, opaque? }) -> id|-1
 *   setVariant(id, variant)         material variant (private `_variant`)
 *   setScrimState(id, state)
 *   setSubduedState(id, state)
 *   removeView(id)                  detach + release (window close cleanup)
 *   isGlassSupported() -> bool      true only when NSGlassEffectView exists
 * Module-level isGlassSupported() is exported too.
 */

#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#import <objc/message.h>
#include <napi.h>
#include <dispatch/dispatch.h>
#include <map>
#include <string>
#include <cctype>
#include <cstring>

namespace {

// Registry so JS can address a view by numeric id. Values are strong under ARC.
std::map<int, NSView *> g_glassViews;
int g_nextViewId = 0;

// objc-associated views on the container, for idempotent re-adds and cleanup.
const void *kGlassEffectKey = &kGlassEffectKey;
const void *kBackgroundViewKey = &kBackgroundViewKey;
const void *kGlassViewIdKey = &kGlassViewIdKey;

bool GlassEffectClassAvailable() {
  return NSClassFromString(@"NSGlassEffectView") != nil;
}

// Convert #RRGGBB or #RRGGBBAA to NSColor* (sRGB). nil on invalid input.
NSColor *ColorFromHexNSString(NSString *hex) {
  NSString *cleaned = [[hex stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]] uppercaseString];
  if ([cleaned hasPrefix:@"#"]) cleaned = [cleaned substringFromIndex:1];
  if (cleaned.length != 6 && cleaned.length != 8) return nil;

  unsigned int rgba = 0;
  NSScanner *scanner = [NSScanner scannerWithString:cleaned];
  if (![scanner scanHexInt:&rgba]) return nil;

  CGFloat r, g, b, a;
  if (cleaned.length == 6) {
    r = ((rgba & 0xFF0000) >> 16) / 255.0;
    g = ((rgba & 0x00FF00) >> 8) / 255.0;
    b = (rgba & 0x0000FF) / 255.0;
    a = 1.0;
  } else {
    r = ((rgba & 0xFF000000) >> 24) / 255.0;
    g = ((rgba & 0x00FF0000) >> 16) / 255.0;
    b = ((rgba & 0x0000FF00) >> 8) / 255.0;
    a = (rgba & 0x000000FF) / 255.0;
  }
  return [NSColor colorWithRed:r green:g blue:b alpha:a];
}

#define RUN_ON_MAIN(block)                           \
  if ([NSThread isMainThread]) {                     \
    block();                                         \
  } else {                                           \
    dispatch_sync(dispatch_get_main_queue(), block); \
  }

/**
 * Create the glass view (or an NSVisualEffectView fallback on macOS < 26) and
 * insert it at the bottom of the window's view stack, below Chromium content.
 *
 * Idempotent: Electron fires dom-ready on every workbench navigation, and a
 * re-add returns the existing view's id instead of stacking a second glass
 * view. Returns -1 on error.
 */
int AddGlassEffectView(unsigned char *buffer, bool opaque) {
  if (!buffer) {
    return -1;
  }

  __block int resultId = -1;

  RUN_ON_MAIN(^{
    NSView *rootView = (__bridge NSView *)*reinterpret_cast<void **>(buffer);
    if (!rootView) return;

    NSView *container = rootView;

    // Reuse an already-installed glass view for this container.
    NSNumber *existingId = objc_getAssociatedObject(container, kGlassViewIdKey);
    NSView *existingGlass = objc_getAssociatedObject(container, kGlassEffectKey);
    if (existingId && existingGlass && existingGlass.superview == container &&
        g_glassViews.find(existingId.intValue) != g_glassViews.end()) {
      resultId = existingId.intValue;
      return;
    }

    // Remove previous glass and background views (if any).
    NSView *oldGlass = objc_getAssociatedObject(container, kGlassEffectKey);
    if (oldGlass) [oldGlass removeFromSuperview];
    NSView *oldBackground = objc_getAssociatedObject(container, kBackgroundViewKey);
    if (oldBackground) [oldBackground removeFromSuperview];

    NSRect bounds = container.bounds;
    NSBox *backgroundView = nil;
    NSView *glass = nil;

    Class glassCls = NSClassFromString(@"NSGlassEffectView");
    if (glassCls) {
      // Real Apple Liquid Glass (macOS 26+).
      glass = [[glassCls alloc] initWithFrame:bounds];

      if (opaque) {
        // Optional opaque backdrop below the glass (windowBackgroundColor).
        backgroundView = [[NSBox alloc] initWithFrame:bounds];
        backgroundView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        backgroundView.boxType = NSBoxCustom;
        backgroundView.fillColor = [NSColor windowBackgroundColor];
        backgroundView.wantsLayer = YES;
        backgroundView.layer.borderWidth = 0;  // no border, without deprecated -borderType
        [container addSubview:backgroundView positioned:NSWindowBelow relativeTo:nil];
      }
    } else {
      // macOS < 26: legacy behind-window blur so the window is never broken.
      NSVisualEffectView *visual = [[NSVisualEffectView alloc] initWithFrame:bounds];
      visual.blendingMode = NSVisualEffectBlendingModeBehindWindow;
      visual.material = NSVisualEffectMaterialUnderWindowBackground;
      visual.state = NSVisualEffectStateActive;
      glass = visual;
    }

    // Follow the Electron window as it resizes.
    glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;

    if (opaque && backgroundView) {
      [container addSubview:glass positioned:NSWindowAbove relativeTo:backgroundView];
    } else {
      [container addSubview:glass positioned:NSWindowBelow relativeTo:nil];
    }

    objc_setAssociatedObject(container, kGlassEffectKey, glass, OBJC_ASSOCIATION_RETAIN);
    objc_setAssociatedObject(container, kBackgroundViewKey, backgroundView, OBJC_ASSOCIATION_RETAIN);

    int id = g_nextViewId++;
    g_glassViews[id] = glass;
    objc_setAssociatedObject(container, kGlassViewIdKey, @(id), OBJC_ASSOCIATION_RETAIN);
    resultId = id;
  });

  return resultId;
}

void ConfigureGlassView(int viewId, double cornerRadius, const char *tintHex) {
  RUN_ON_MAIN(^{
    auto it = g_glassViews.find(viewId);
    if (it == g_glassViews.end()) return;
    NSView *glass = it->second;

    // Corner radius via CALayer.
    glass.wantsLayer = YES;
    glass.layer.cornerRadius = cornerRadius;
    glass.layer.masksToBounds = YES;

    NSView *container = glass.superview;
    NSView *backgroundView = objc_getAssociatedObject(container, kBackgroundViewKey);
    if (backgroundView) {
      backgroundView.wantsLayer = YES;
      backgroundView.layer.cornerRadius = cornerRadius;
      backgroundView.layer.masksToBounds = YES;
    }

    if (tintHex && strlen(tintHex) > 0) {
      NSString *hex = [NSString stringWithUTF8String:tintHex];
      NSColor *c = ColorFromHexNSString(hex);
      if (c && [glass respondsToSelector:@selector(setTintColor:)]) {
        [(id)glass setTintColor:c];
      } else if (c) {
        glass.layer.backgroundColor = c.CGColor;
      }
    }
  });
}

// Build the private (set_<key>:) or public (setKey:) setter for a property.
SEL SetterFromKey(const std::string &key, bool privateVariant) {
  std::string name;
  if (privateVariant) {
    if (!key.empty() && key.front() != '_')
      name = "_" + key;
    else
      name = key;
    name = "set" + name;
  } else {
    if (key.empty()) return nil;
    name = "set";
    name += (char)toupper(key[0]);
    name += key.substr(1);
  }
  name += ":";
  return sel_registerName(name.c_str());
}

SEL ResolveSetter(id obj, const char *cKey) {
  if (!cKey) return nil;
  std::string key(cKey);
  if (key.empty()) return nil;
  SEL sel = SetterFromKey(key, true);
  if ([obj respondsToSelector:sel]) return sel;
  sel = SetterFromKey(key, false);
  if ([obj respondsToSelector:sel]) return sel;
  return nil;
}

void SetGlassViewIntProperty(int viewId, const char *key, long long value) {
  RUN_ON_MAIN(^{
    auto it = g_glassViews.find(viewId);
    if (it == g_glassViews.end()) return;
    NSView *glass = it->second;

    SEL sel = ResolveSetter(glass, key);
    if (!sel) return;
    ((void (*)(id, SEL, long long))objc_msgSend)(glass, sel, value);
  });
}

// Detach a glass view and drop every reference (window-close cleanup; without
// this the registry keeps one detached view alive per closed window).
void RemoveGlassView(int viewId) {
  RUN_ON_MAIN(^{
    auto it = g_glassViews.find(viewId);
    if (it == g_glassViews.end()) return;
    NSView *glass = it->second;

    NSView *container = glass.superview;
    if (container) {
      NSView *backgroundView = objc_getAssociatedObject(container, kBackgroundViewKey);
      if (backgroundView) [backgroundView removeFromSuperview];
      objc_setAssociatedObject(container, kGlassEffectKey, nil, OBJC_ASSOCIATION_ASSIGN);
      objc_setAssociatedObject(container, kBackgroundViewKey, nil, OBJC_ASSOCIATION_ASSIGN);
      objc_setAssociatedObject(container, kGlassViewIdKey, nil, OBJC_ASSOCIATION_ASSIGN);
    }
    [glass removeFromSuperview];
    g_glassViews.erase(it);
  });
}

// ---------------------------------------------------------------------------
// N-API bindings
// ---------------------------------------------------------------------------

class LiquidGlassNative : public Napi::ObjectWrap<LiquidGlassNative> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "LiquidGlassNative", {
      InstanceMethod("addView", &LiquidGlassNative::AddView),
      InstanceMethod("setVariant", &LiquidGlassNative::SetVariant),
      InstanceMethod("setScrimState", &LiquidGlassNative::SetScrimState),
      InstanceMethod("setSubduedState", &LiquidGlassNative::SetSubduedState),
      InstanceMethod("removeView", &LiquidGlassNative::RemoveView),
      InstanceMethod("isGlassSupported", &LiquidGlassNative::IsGlassSupported),
    });

    Napi::FunctionReference *constructor = new Napi::FunctionReference();
    *constructor = Napi::Persistent(func);
    env.SetInstanceData(constructor);

    exports.Set("LiquidGlassNative", func);
    return exports;
  }

  LiquidGlassNative(const Napi::CallbackInfo &info)
      : Napi::ObjectWrap<LiquidGlassNative>(info) {}

private:
  Napi::Value AddView(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsBuffer()) {
      Napi::TypeError::New(env, "Expected first argument to be a Buffer returned by getNativeWindowHandle()")
          .ThrowAsJavaScriptException();
      return env.Null();
    }

    double radius = 0.0;
    std::string tint;
    bool opaque = false;
    if (info.Length() >= 2 && info[1].IsObject()) {
      auto obj = info[1].As<Napi::Object>();
      if (obj.Has("cornerRadius") && obj.Get("cornerRadius").IsNumber()) {
        radius = obj.Get("cornerRadius").As<Napi::Number>().DoubleValue();
      }
      if (obj.Has("tintColor") && obj.Get("tintColor").IsString()) {
        tint = obj.Get("tintColor").As<Napi::String>().Utf8Value();
      }
      if (obj.Has("opaque") && obj.Get("opaque").IsBoolean()) {
        opaque = obj.Get("opaque").As<Napi::Boolean>().Value();
      }
    }

    auto buffer = info[0].As<Napi::Buffer<unsigned char>>();
    if (buffer.Length() < sizeof(void *)) {
      Napi::TypeError::New(env, "Native window handle buffer is too small")
          .ThrowAsJavaScriptException();
      return env.Null();
    }

    int viewId = AddGlassEffectView(buffer.Data(), opaque);
    if (viewId >= 0) {
      ConfigureGlassView(viewId, radius, tint.c_str());
    }
    return Napi::Number::New(env, viewId);
  }

  Napi::Value SetVariant(const Napi::CallbackInfo &info) {
    return ApplyIntPropFromArgs(info, "variant");
  }

  Napi::Value SetScrimState(const Napi::CallbackInfo &info) {
    return ApplyIntPropFromArgs(info, "scrimState");
  }

  Napi::Value SetSubduedState(const Napi::CallbackInfo &info) {
    return ApplyIntPropFromArgs(info, "subduedState");
  }

  Napi::Value RemoveView(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
      Napi::TypeError::New(env, "Expected (id:number)").ThrowAsJavaScriptException();
      return env.Null();
    }
    RemoveGlassView(info[0].As<Napi::Number>().Int32Value());
    return env.Undefined();
  }

  Napi::Value IsGlassSupported(const Napi::CallbackInfo &info) {
    return Napi::Boolean::New(info.Env(), GlassEffectClassAvailable());
  }

  Napi::Value ApplyIntPropFromArgs(const Napi::CallbackInfo &info, const char *key) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
      Napi::TypeError::New(env, "Expected (id:number, value:number)").ThrowAsJavaScriptException();
      return env.Null();
    }
    int id = info[0].As<Napi::Number>().Int32Value();
    long long value = info[1].As<Napi::Number>().Int64Value();
    SetGlassViewIntProperty(id, key, value);
    return env.Undefined();
  }
};

Napi::Value IsGlassSupportedFreeFunction(const Napi::CallbackInfo &info) {
  return Napi::Boolean::New(info.Env(), GlassEffectClassAvailable());
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports = LiquidGlassNative::Init(env, exports);
  exports.Set("isGlassSupported", Napi::Function::New(env, IsGlassSupportedFreeFunction));
  return exports;
}

}  // namespace

NODE_API_MODULE(liquidglass, Init)
