#include <napi.h>
#include <windows.h>

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

    // 4. Invoke Win32 API to enforce affinity
    BOOL success = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);

    return Napi::Boolean::New(env, success ? true : false);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "EnforceDisplayAffinity"),
                Napi::Function::New(env, EnforceDisplayAffinity));
    return exports;
}

NODE_API_MODULE(display_affinity, Init)
