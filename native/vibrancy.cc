#include <napi.h>
#include <dwmapi.h>
#include <shellscalingapi.h>

#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "shcore.lib")

enum AccentState {
    ACCENT_DISABLED = 0,
    ACCENT_ENABLE_GRADIENT = 1,
    ACCENT_ENABLE_TRANSPARENTGRADIENT = 2,
    ACCENT_ENABLE_BLURBEHIND = 3,
    ACCENT_ENABLE_ACRYLICBLURBEHIND = 4,
    ACCENT_ENABLE_HOSTBACKDROP = 5, // RS5 1809
    ACCENT_INVALID_STATE = 6
};

enum WindowCompositionAttribute {
    WCA_ACCENT_POLICY = 19
};

struct AccentPolicy {
    AccentState accentState;
    int accentFlags;
    int gradientColor;
    int animationId;
};

struct WindowCompositionAttributeData {
    WindowCompositionAttribute attribute;
    PVOID pData;
    ULONG dataSize;
};

typedef BOOL(WINAPI
*pSetWindowCompositionAttribute)(HWND, WindowCompositionAttributeData*);

const HINSTANCE hModule = LoadLibrary(TEXT("user32.dll"));

void setVibrancy(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    try {
        if (info.Length() == 0) {
            Napi::TypeError::New(env, "WINDOW_NOT_GIVEN").ThrowAsJavaScriptException();
            return;
        }
        if (info.Length() != 6) {
            Napi::TypeError::New(env, "PARAMETER_ERROR").ThrowAsJavaScriptException();
            return;
        }
        if (!info[0].IsNumber()) {
            Napi::TypeError::New(env, "UNKNOWN").ThrowAsJavaScriptException();
            return;
        }
        HWND hWnd = (HWND) info[0].As<Napi::Number>().Int64Value();
        int effect = info[1].As<Napi::Number>().Int32Value();

        int redValue = info[2].As<Napi::Number>().Int32Value();
        int greenValue = info[3].As<Napi::Number>().Int32Value();
        int blueValue = info[4].As<Napi::Number>().Int32Value();
        int alphaValue = info[5].As<Napi::Number>().Int32Value();

        if (hModule) {
            const pSetWindowCompositionAttribute SetWindowCompositionAttribute = (pSetWindowCompositionAttribute) GetProcAddress(
                    hModule, "SetWindowCompositionAttribute");
            if (SetWindowCompositionAttribute) {
                int gradientColor = (alphaValue<<24) + (blueValue<<16) + (greenValue<<8) + (redValue);
                AccentState blurType;
                switch (effect) {
                    case ACCENT_ENABLE_TRANSPARENTGRADIENT:
                    case ACCENT_ENABLE_BLURBEHIND:
                    case ACCENT_ENABLE_ACRYLICBLURBEHIND:
                        blurType = static_cast<AccentState>(effect);
                        break;
                    default:
                        blurType = ACCENT_ENABLE_BLURBEHIND;
                        break;
                }
                AccentPolicy policy = {blurType, 2, gradientColor, 0};
                WindowCompositionAttributeData data = {WCA_ACCENT_POLICY, &policy, sizeof(AccentPolicy)};
                SetWindowCompositionAttribute(hWnd, &data);
            } else {
                Napi::Error::New(env, "FAIL_LOAD_DLL").ThrowAsJavaScriptException();
                return;
            }
            FreeLibrary(hModule);
        } else {
            Napi::Error::New(env, "FAIL_LOAD_DLL").ThrowAsJavaScriptException();
            return;
        }
    } catch (const char *ex) {
        Napi::Error::New(env, "UNKNOWN").ThrowAsJavaScriptException();
    }
}

void disableVibrancy(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    try {
        if (info.Length() != 1) {
            Napi::TypeError::New(env, "WINDOW_NOT_GIVEN").ThrowAsJavaScriptException();
            return;
        }
        if (!info[0].IsNumber()) {
            Napi::TypeError::New(env, "UNKNOWN").ThrowAsJavaScriptException();
            return;
        }
        HWND hWnd = (HWND) info[0].As<Napi::Number>().Int64Value();
        if (hModule) {
            const pSetWindowCompositionAttribute SetWindowCompositionAttribute = (pSetWindowCompositionAttribute) GetProcAddress(
                    hModule, "SetWindowCompositionAttribute");
            if (SetWindowCompositionAttribute) {
                AccentPolicy policy = {ACCENT_DISABLED, 0, 0, 0};
                WindowCompositionAttributeData data = {WCA_ACCENT_POLICY, &policy, sizeof(AccentPolicy)};
                SetWindowCompositionAttribute(hWnd, &data);
            } else {
                Napi::Error::New(env, "FAIL_LOAD_DLL").ThrowAsJavaScriptException();
                return;
            }
            FreeLibrary(hModule);
        } else {
            Napi::Error::New(env, "FAIL_LOAD_DLL").ThrowAsJavaScriptException();
            return;
        }
    } catch (const char *ex) {
        Napi::Error::New(env, "UNKNOWN").ThrowAsJavaScriptException();
    }
}

// DWMWA_TRANSITIONS_FORCEDISABLED: turn off the window's maximize, restore and
// snap animations. DWM draws them without the legacy acrylic accent, so the
// window shows through unblurred until the animation ends.
void setTransitionsDisabled(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    if (info.Length() != 2) {
        Napi::TypeError::New(env, "PARAMETER_ERROR").ThrowAsJavaScriptException();
        return;
    }
    if (!info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env, "UNKNOWN").ThrowAsJavaScriptException();
        return;
    }
    HWND hWnd = (HWND) info[0].As<Napi::Number>().Int64Value();
    BOOL disabled = info[1].As<Napi::Boolean>().Value() ? TRUE : FALSE;
    DwmSetWindowAttribute(hWnd, DWMWA_TRANSITIONS_FORCEDISABLED, &disabled, sizeof(disabled));
}

// Window geometry in physical pixels, for moving the window while it's dragged
// (runtime-pre-esm/win-acrylic-drag.cjs). Electron's DIP-based setPosition and
// setBounds resize the window a little on every call on a scaled display.

bool readNumbers(const Napi::CallbackInfo &info, size_t count) {
    if (info.Length() < count) {
        Napi::TypeError::New(info.Env(), "PARAMETER_ERROR").ThrowAsJavaScriptException();
        return false;
    }
    for (size_t i = 0; i < count; i++) {
        if (!info[i].IsNumber()) {
            Napi::TypeError::New(info.Env(), "UNKNOWN").ThrowAsJavaScriptException();
            return false;
        }
    }
    return true;
}

Napi::Value getCursorPos(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    POINT p;
    if (!GetCursorPos(&p)) return env.Null();
    Napi::Object result = Napi::Object::New(env);
    result.Set("x", p.x);
    result.Set("y", p.y);
    return result;
}

// { x, y, width, height, dpi }
Napi::Value getWindowRect(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    if (!readNumbers(info, 1)) return env.Null();
    HWND hWnd = (HWND) info[0].As<Napi::Number>().Int64Value();
    RECT r;
    if (!GetWindowRect(hWnd, &r)) return env.Null();
    Napi::Object result = Napi::Object::New(env);
    result.Set("x", r.left);
    result.Set("y", r.top);
    result.Set("width", r.right - r.left);
    result.Set("height", r.bottom - r.top);
    result.Set("dpi", GetDpiForWindow(hWnd));
    return result;
}

// setWindowPos(hwnd, x, y) moves the window; with width and height it also
// resizes it. Never activates it or changes its z-order.
void setWindowPos(const Napi::CallbackInfo &info) {
    if (!readNumbers(info, 3)) return;
    HWND hWnd = (HWND) info[0].As<Napi::Number>().Int64Value();
    int x = info[1].As<Napi::Number>().Int32Value();
    int y = info[2].As<Napi::Number>().Int32Value();
    UINT flags = SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_NOACTIVATE;
    int width = 0, height = 0;
    if (info.Length() >= 5 && info[3].IsNumber() && info[4].IsNumber()) {
        width = info[3].As<Napi::Number>().Int32Value();
        height = info[4].As<Napi::Number>().Int32Value();
    } else {
        flags |= SWP_NOSIZE;
    }
    SetWindowPos(hWnd, NULL, x, y, width, height, flags);
}

// The effective DPI of the monitor a rect (x, y, width, height) mostly lies on.
Napi::Value getDpiForRect(const Napi::CallbackInfo &info) {
    Napi::Env env = info.Env();
    if (!readNumbers(info, 4)) return env.Null();
    RECT r;
    r.left = info[0].As<Napi::Number>().Int32Value();
    r.top = info[1].As<Napi::Number>().Int32Value();
    r.right = r.left + info[2].As<Napi::Number>().Int32Value();
    r.bottom = r.top + info[3].As<Napi::Number>().Int32Value();
    UINT dpiX = 0, dpiY = 0;
    HMONITOR monitor = MonitorFromRect(&r, MONITOR_DEFAULTTONEAREST);
    if (FAILED(GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &dpiX, &dpiY))) return env.Null();
    return Napi::Number::New(env, dpiX);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "setVibrancy"),
                Napi::Function::New(env, setVibrancy));
    exports.Set(Napi::String::New(env, "disableVibrancy"),
                Napi::Function::New(env, disableVibrancy));
    exports.Set(Napi::String::New(env, "setTransitionsDisabled"),
                Napi::Function::New(env, setTransitionsDisabled));
    exports.Set(Napi::String::New(env, "getCursorPos"),
                Napi::Function::New(env, getCursorPos));
    exports.Set(Napi::String::New(env, "getWindowRect"),
                Napi::Function::New(env, getWindowRect));
    exports.Set(Napi::String::New(env, "setWindowPos"),
                Napi::Function::New(env, setWindowPos));
    exports.Set(Napi::String::New(env, "getDpiForRect"),
                Napi::Function::New(env, getDpiForRect));
    return exports;
}

NODE_API_MODULE(vibrancy, Init
)
