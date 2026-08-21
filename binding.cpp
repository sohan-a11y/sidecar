#include <napi.h>
#include <windows.h>
#include <string>

// WDA_EXCLUDEFROMCAPTURE is 0x00000011 (excludes the window from capture)
#ifndef WDA_EXCLUDEFROMCAPTURE
#define WDA_EXCLUDEFROMCAPTURE 0x00000011
#endif

Napi::Boolean EnforceDisplayAffinity(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // 1. Argument Validation
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Argument expected: HWND Buffer").ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }

    if (!info[0].IsBuffer()) {
        Napi::TypeError::New(env, "Argument must be a Buffer").ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }

    Napi::Buffer<char> buffer = info[0].As<Napi::Buffer<char>>();
    char* data = buffer.Data();
    size_t length = buffer.ByteLength();

    // 2. Safe HWND Extraction
    HWND hwnd = nullptr;
    if (length == sizeof(HWND)) {
        hwnd = *reinterpret_cast<HWND*>(data);
    } else if (length == 8) {
        hwnd = reinterpret_cast<HWND>(*reinterpret_cast<uint64_t*>(data));
    } else if (length == 4) {
        hwnd = reinterpret_cast<HWND>(static_cast<LONG_PTR>(*reinterpret_cast<uint32_t*>(data)));
    } else {
        Napi::Error::New(env, "Invalid buffer length for Win32 HWND").ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }

    // 3. HWND Validity Verification
    if (hwnd == nullptr || !IsWindow(hwnd)) {
        Napi::Error::New(env, "Provided HWND is invalid or null").ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }

    // 4. Invoke Win32 API to enforce screen share invisibility
    SetLastError(ERROR_SUCCESS);
    BOOL success = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);

    if (!success) {
        DWORD errorCode = GetLastError();
        Napi::Error error = Napi::Error::New(
            env,
            "SetWindowDisplayAffinity failed with Win32 error " + std::to_string(errorCode)
        );
        error.Set("win32Error", Napi::Number::New(env, errorCode));
        error.ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }

    // 5. Invoke Win32 API to enforce Task Manager Invisibility (Demotion to Background Process)
    // We strip the standard Application flag and forcefully apply the Tool Window flag.
    // This removes the app from the primary Task Manager "Apps" list and the Alt+Tab menu.
    LONG_PTR exStyle = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    exStyle &= ~WS_EX_APPWINDOW; 
    exStyle |= WS_EX_TOOLWINDOW; 
    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, exStyle);

    return Napi::Boolean::New(env, true);
}

Napi::Value GetDisplayAffinity(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // 1. Argument Validation
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Argument expected: HWND Buffer").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (!info[0].IsBuffer()) {
        Napi::TypeError::New(env, "Argument must be a Buffer").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Buffer<char> buffer = info[0].As<Napi::Buffer<char>>();
    char* data = buffer.Data();
    size_t length = buffer.ByteLength();

    // 2. Safe HWND Extraction
    HWND hwnd = nullptr;
    if (length == sizeof(HWND)) {
        hwnd = *reinterpret_cast<HWND*>(data);
    } else if (length == 8) {
        hwnd = reinterpret_cast<HWND>(*reinterpret_cast<uint64_t*>(data));
    } else if (length == 4) {
        hwnd = reinterpret_cast<HWND>(static_cast<LONG_PTR>(*reinterpret_cast<uint32_t*>(data)));
    } else {
        Napi::Error::New(env, "Invalid buffer length for Win32 HWND").ThrowAsJavaScriptException();
        return env.Null();
    }

    // 3. HWND Validity Verification
    if (hwnd == nullptr || !IsWindow(hwnd)) {
        Napi::Error::New(env, "Provided HWND is invalid or null").ThrowAsJavaScriptException();
        return env.Null();
    }

    // 4. Call GetWindowDisplayAffinity
    DWORD affinity = 0;
    SetLastError(ERROR_SUCCESS);
    BOOL success = GetWindowDisplayAffinity(hwnd, &affinity);

    if (!success) {
        DWORD errorCode = GetLastError();
        Napi::Error error = Napi::Error::New(
            env,
            "GetWindowDisplayAffinity failed with Win32 error " + std::to_string(errorCode)
        );
        error.Set("win32Error", Napi::Number::New(env, errorCode));
        error.ThrowAsJavaScriptException();
        return env.Null();
    }

    return Napi::Number::New(env, affinity);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "EnforceDisplayAffinity"),
                Napi::Function::New(env, EnforceDisplayAffinity));
    exports.Set(Napi::String::New(env, "GetWindowDisplayAffinity"),
                Napi::Function::New(env, GetDisplayAffinity));
    return exports;
}

NODE_API_MODULE(display_affinity, Init)
