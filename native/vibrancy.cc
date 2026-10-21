#include <napi.h>
#include <dwmapi.h>

#pragma comment(lib, "dwmapi.lib")

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

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "setVibrancy"),
                Napi::Function::New(env, setVibrancy));
    exports.Set(Napi::String::New(env, "disableVibrancy"),
                Napi::Function::New(env, disableVibrancy));
    exports.Set(Napi::String::New(env, "setTransitionsDisabled"),
                Napi::Function::New(env, setTransitionsDisabled));
    return exports;
}

NODE_API_MODULE(vibrancy, Init
)
