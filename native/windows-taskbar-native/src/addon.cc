#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <windows.h>
#include <node_api.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <cwchar>
#include <iterator>
#include <limits>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

constexpr uint32_t kApiVersion = 2;
constexpr wchar_t kPrimaryTaskbarClass[] = L"Shell_TrayWnd";
constexpr wchar_t kTrayNotifyClass[] = L"TrayNotifyWnd";

struct AddonError final : public std::runtime_error {
  AddonError(std::string code, std::string message)
      : std::runtime_error(std::move(message)), code(std::move(code)) {}

  std::string code;
};

struct AttachOptions {
  double widthDip;
  double heightDip;
  double gapDip;
  double cornerRadiusDip;
};

struct Layout {
  HWND taskbar = nullptr;
  RECT screenBounds{};
  UINT dpi = 0;
  int cornerRadiusPx = 0;
  std::string edge;
};

struct AttachmentState {
  HWND child = nullptr;
  HWND originalParent = nullptr;
  LONG_PTR originalStyle = 0;
  LONG_PTR originalExStyle = 0;
  RECT originalScreenRect{};
  bool originalVisible = false;

  HWND taskbar = nullptr;
  RECT attachedScreenRect{};
  UINT dpi = 0;
  int cornerRadiusPx = 0;
  std::string edge;
};

std::mutex gAttachmentsMutex;
std::unordered_map<HWND, AttachmentState> gAttachments;

std::string WideToUtf8(const std::wstring& value) {
  if (value.empty()) return {};

  const int required = WideCharToMultiByte(
      CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
      static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  if (required <= 0) return "Unknown Windows error";

  std::string result(static_cast<size_t>(required), '\0');
  if (WideCharToMultiByte(
          CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
          static_cast<int>(value.size()), result.data(), required, nullptr,
          nullptr) <= 0) {
    return "Unknown Windows error";
  }
  return result;
}

std::string FormatWin32Error(DWORD error) {
  if (error == ERROR_SUCCESS) error = ERROR_GEN_FAILURE;

  wchar_t* rawMessage = nullptr;
  const DWORD length = FormatMessageW(
      FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
          FORMAT_MESSAGE_IGNORE_INSERTS,
      nullptr, error, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
      reinterpret_cast<wchar_t*>(&rawMessage), 0, nullptr);

  std::wstring message;
  if (length != 0 && rawMessage != nullptr) {
    message.assign(rawMessage, length);
    LocalFree(rawMessage);
    while (!message.empty() &&
           (message.back() == L'\r' || message.back() == L'\n' ||
            message.back() == L' ' || message.back() == L'.')) {
      message.pop_back();
    }
  } else {
    message = L"Unknown Windows error";
  }

  std::ostringstream output;
  output << WideToUtf8(message) << " (Win32 " << error << ')';
  return output.str();
}

[[noreturn]] void ThrowWin32(const char* code, const char* operation,
                             DWORD error = GetLastError()) {
  if (error == ERROR_SUCCESS) error = ERROR_GEN_FAILURE;
  std::ostringstream message;
  message << operation << " failed: " << FormatWin32Error(error);
  throw AddonError(code, message.str());
}

void CheckNapi(napi_env env, napi_status status, const char* operation) {
  if (status == napi_ok) return;

  const napi_extended_error_info* info = nullptr;
  napi_get_last_error_info(env, &info);
  std::ostringstream message;
  message << operation << " failed";
  if (info != nullptr && info->error_message != nullptr) {
    message << ": " << info->error_message;
  }
  throw AddonError("ERR_NAPI", message.str());
}

HWND ParseWindowHandleBuffer(napi_env env, napi_value value) {
  bool isBuffer = false;
  CheckNapi(env, napi_is_buffer(env, value, &isBuffer), "napi_is_buffer");
  if (!isBuffer) {
    throw AddonError("ERR_INVALID_HWND", "hwnd must be a Buffer.");
  }

  void* data = nullptr;
  size_t length = 0;
  CheckNapi(env, napi_get_buffer_info(env, value, &data, &length),
            "napi_get_buffer_info");
  if (data == nullptr || length != sizeof(HWND)) {
    throw AddonError(
        "ERR_INVALID_HWND",
        "hwnd Buffer length must exactly match the native pointer size.");
  }

  HWND hwnd = nullptr;
  std::memcpy(&hwnd, data, sizeof(hwnd));
  if (hwnd == nullptr) {
    throw AddonError("ERR_INVALID_HWND", "hwnd must not be null.");
  }
  return hwnd;
}

void ValidateOwnedWindowHandle(HWND hwnd) {
  if (!IsWindow(hwnd)) {
    throw AddonError("ERR_INVALID_HWND", "hwnd is not a live window.");
  }

  DWORD processId = 0;
  if (GetWindowThreadProcessId(hwnd, &processId) == 0) {
    ThrowWin32("ERR_INVALID_HWND", "GetWindowThreadProcessId");
  }
  if (processId != GetCurrentProcessId()) {
    throw AddonError(
        "ERR_FOREIGN_HWND",
        "hwnd must belong to the current LyricsAdapter process.");
  }

}

HWND ParseOwnedWindowHandle(napi_env env, napi_value value) {
  const HWND hwnd = ParseWindowHandleBuffer(env, value);
  ValidateOwnedWindowHandle(hwnd);
  return hwnd;
}

double ReadRequiredNumber(napi_env env, napi_value object,
                          const char* propertyName, double minimum,
                          double maximum) {
  bool hasProperty = false;
  CheckNapi(env,
            napi_has_named_property(env, object, propertyName, &hasProperty),
            "napi_has_named_property");
  if (!hasProperty) {
    throw AddonError("ERR_INVALID_OPTIONS",
                     std::string("Missing numeric option: ") + propertyName);
  }

  napi_value property;
  CheckNapi(env, napi_get_named_property(env, object, propertyName, &property),
            "napi_get_named_property");
  napi_valuetype type = napi_undefined;
  CheckNapi(env, napi_typeof(env, property, &type), "napi_typeof");
  if (type != napi_number) {
    throw AddonError("ERR_INVALID_OPTIONS",
                     std::string(propertyName) + " must be a number.");
  }

  double number = 0;
  CheckNapi(env, napi_get_value_double(env, property, &number),
            "napi_get_value_double");
  if (!std::isfinite(number) || number < minimum || number > maximum) {
    std::ostringstream message;
    message << propertyName << " must be finite and within [" << minimum
            << ", " << maximum << "].";
    throw AddonError("ERR_INVALID_OPTIONS", message.str());
  }
  return number;
}

AttachOptions ParseOptions(napi_env env, napi_value value) {
  napi_valuetype type = napi_undefined;
  CheckNapi(env, napi_typeof(env, value, &type), "napi_typeof");
  if (type != napi_object) {
    throw AddonError("ERR_INVALID_OPTIONS", "options must be an object.");
  }

  return {
      ReadRequiredNumber(env, value, "widthDip", 64.0, 2048.0),
      ReadRequiredNumber(env, value, "heightDip", 16.0, 256.0),
      ReadRequiredNumber(env, value, "gapDip", 0.0, 256.0),
      ReadRequiredNumber(env, value, "cornerRadiusDip", 0.0, 128.0),
  };
}

LONG_PTR GetWindowLongPtrChecked(HWND hwnd, int index) {
  SetLastError(ERROR_SUCCESS);
  const LONG_PTR value = GetWindowLongPtrW(hwnd, index);
  const DWORD error = GetLastError();
  if (value == 0 && error != ERROR_SUCCESS) {
    ThrowWin32("ERR_WINDOW_STYLE", "GetWindowLongPtrW", error);
  }
  return value;
}

void SetWindowLongPtrChecked(HWND hwnd, int index, LONG_PTR value) {
  SetLastError(ERROR_SUCCESS);
  const LONG_PTR previous = SetWindowLongPtrW(hwnd, index, value);
  const DWORD error = GetLastError();
  if (previous == 0 && error != ERROR_SUCCESS) {
    ThrowWin32("ERR_WINDOW_STYLE", "SetWindowLongPtrW", error);
  }
}

void SetParentChecked(HWND child, HWND parent) {
  SetLastError(ERROR_SUCCESS);
  const HWND previous = SetParent(child, parent);
  const DWORD error = GetLastError();
  if (previous == nullptr && error != ERROR_SUCCESS) {
    ThrowWin32("ERR_SET_PARENT", "SetParent", error);
  }
}

RECT GetWindowRectChecked(HWND hwnd, const char* code) {
  RECT rect{};
  if (!GetWindowRect(hwnd, &rect)) {
    ThrowWin32(code, "GetWindowRect");
  }
  return rect;
}

DPI_AWARENESS GetWindowAwarenessChecked(HWND hwnd) {
  const DPI_AWARENESS_CONTEXT context = GetWindowDpiAwarenessContext(hwnd);
  if (context == nullptr) {
    ThrowWin32("ERR_DPI_AWARENESS", "GetWindowDpiAwarenessContext");
  }
  const DPI_AWARENESS awareness =
      GetAwarenessFromDpiAwarenessContext(context);
  if (awareness == DPI_AWARENESS_INVALID) {
    throw AddonError("ERR_DPI_AWARENESS",
                     "The window has an invalid DPI awareness context.");
  }
  return awareness;
}

BOOL CALLBACK FindTrayNotifyWindow(HWND hwnd, LPARAM parameter) {
  auto* result = reinterpret_cast<HWND*>(parameter);
  wchar_t className[128]{};
  const int length = GetClassNameW(hwnd, className,
                                   static_cast<int>(std::size(className)));
  if (length > 0 && std::wcscmp(className, kTrayNotifyClass) == 0) {
    *result = hwnd;
    return FALSE;
  }
  return TRUE;
}

HWND FindTrayNotifyWindowRecursive(HWND taskbar) {
  HWND tray = nullptr;
  EnumChildWindows(taskbar, FindTrayNotifyWindow,
                   reinterpret_cast<LPARAM>(&tray));
  return tray;
}

int DipToPixels(double dip, UINT dpi) {
  const double pixels = dip * static_cast<double>(dpi) / 96.0;
  if (!std::isfinite(pixels) || pixels < 0.0 ||
      pixels > static_cast<double>(std::numeric_limits<int>::max())) {
    throw AddonError("ERR_INVALID_OPTIONS",
                     "DIP conversion exceeded the supported pixel range.");
  }
  return static_cast<int>(std::lround(pixels));
}

bool RectEquals(const RECT& left, const RECT& right) {
  return left.left == right.left && left.top == right.top &&
         left.right == right.right && left.bottom == right.bottom;
}

int RectWidth(const RECT& rect) { return rect.right - rect.left; }
int RectHeight(const RECT& rect) { return rect.bottom - rect.top; }

Layout CalculateLayout(HWND child, const AttachOptions& options) {
  HWND taskbar = FindWindowW(kPrimaryTaskbarClass, nullptr);
  if (taskbar == nullptr || !IsWindow(taskbar)) {
    throw AddonError("ERR_TASKBAR_NOT_FOUND",
                     "The primary Shell_TrayWnd is not available.");
  }

  DWORD taskbarProcessId = 0;
  if (GetWindowThreadProcessId(taskbar, &taskbarProcessId) == 0 ||
      taskbarProcessId == 0) {
    ThrowWin32("ERR_TASKBAR_NOT_FOUND", "GetWindowThreadProcessId");
  }

  const DPI_AWARENESS childAwareness = GetWindowAwarenessChecked(child);
  const DPI_AWARENESS taskbarAwareness = GetWindowAwarenessChecked(taskbar);
  if (childAwareness != taskbarAwareness) {
    throw AddonError(
        "ERR_DPI_AWARENESS_MISMATCH",
        "The Electron window and Explorer taskbar use different DPI awareness modes.");
  }

  const UINT dpi = GetDpiForWindow(taskbar);
  if (dpi == 0) {
    ThrowWin32("ERR_TASKBAR_NOT_READY", "GetDpiForWindow");
  }

  const RECT taskbarRect =
      GetWindowRectChecked(taskbar, "ERR_TASKBAR_NOT_READY");
  const int taskbarWidth = RectWidth(taskbarRect);
  const int taskbarHeight = RectHeight(taskbarRect);
  if (taskbarWidth <= 0 || taskbarHeight <= 0) {
    throw AddonError("ERR_TASKBAR_NOT_READY",
                     "The primary taskbar has invalid bounds.");
  }
  if (taskbarHeight >= taskbarWidth) {
    throw AddonError("ERR_VERTICAL_TASKBAR",
                     "Vertical taskbars are not supported safely.");
  }

  HWND tray = FindTrayNotifyWindowRecursive(taskbar);
  if (tray == nullptr || !IsWindow(tray)) {
    throw AddonError("ERR_TRAY_NOT_FOUND",
                     "TrayNotifyWnd was not found below Shell_TrayWnd.");
  }
  const RECT trayRect = GetWindowRectChecked(tray, "ERR_TRAY_NOT_FOUND");
  RECT trayIntersection{};
  if (!IntersectRect(&trayIntersection, &taskbarRect, &trayRect) ||
      RectWidth(trayIntersection) <= 0 || RectHeight(trayIntersection) <= 0) {
    throw AddonError("ERR_TRAY_NOT_FOUND",
                     "TrayNotifyWnd does not intersect the primary taskbar.");
  }

  const int width = DipToPixels(options.widthDip, dpi);
  const int height = DipToPixels(options.heightDip, dpi);
  const int gap = DipToPixels(options.gapDip, dpi);
  if (width <= 0 || height <= 0 || height > taskbarHeight ||
      width > taskbarWidth) {
    throw AddonError("ERR_TASKBAR_TOO_SMALL",
                     "The requested widget does not fit in the taskbar.");
  }

  const long long taskbarCenter =
      static_cast<long long>(taskbarRect.left) + taskbarWidth / 2;
  const long long trayCenter =
      static_cast<long long>(trayRect.left) + RectWidth(trayRect) / 2;

  int x = 0;
  if (trayCenter < taskbarCenter) {
    x = trayRect.right + gap;
    if (x < taskbarRect.left || x + width > taskbarRect.right) {
      throw AddonError("ERR_TASKBAR_TOO_SMALL",
                       "There is no safe space to the right of the tray.");
    }
  } else {
    x = trayRect.left - gap - width;
    if (x < taskbarRect.left || x + width > taskbarRect.right) {
      throw AddonError("ERR_TASKBAR_TOO_SMALL",
                       "There is no safe space to the left of the tray.");
    }
  }

  const int y = taskbarRect.top + (taskbarHeight - height) / 2;
  RECT bounds{x, y, x + width, y + height};

  MONITORINFO monitorInfo{};
  monitorInfo.cbSize = sizeof(monitorInfo);
  const HMONITOR monitor =
      MonitorFromWindow(taskbar, MONITOR_DEFAULTTONULL);
  if (monitor == nullptr || !GetMonitorInfoW(monitor, &monitorInfo)) {
    ThrowWin32("ERR_TASKBAR_NOT_READY", "GetMonitorInfoW");
  }
  const long long topDistance =
      std::llabs(static_cast<long long>(taskbarRect.top) -
                 monitorInfo.rcMonitor.top);
  const long long bottomDistance =
      std::llabs(static_cast<long long>(monitorInfo.rcMonitor.bottom) -
                 taskbarRect.bottom);

  const int requestedRadius = DipToPixels(options.cornerRadiusDip, dpi);
  const int radius =
      std::clamp(requestedRadius, 0, std::min(width, height) / 2);

  return {
      taskbar,
      bounds,
      dpi,
      radius,
      topDistance <= bottomDistance ? "top" : "bottom",
  };
}

struct RestoreResult {
  bool ok = true;
  std::string errors;
};

void RecordRestoreError(RestoreResult& result, const char* operation,
                        DWORD error) {
  result.ok = false;
  if (!result.errors.empty()) result.errors += "; ";
  result.errors += operation;
  result.errors += ": ";
  result.errors += FormatWin32Error(error);
}

RestoreResult RestoreOriginalWindow(const AttachmentState& state) noexcept {
  RestoreResult result;
  if (state.child == nullptr || !IsWindow(state.child)) return result;

  SetLastError(ERROR_SUCCESS);
  if (SetWindowRgn(state.child, nullptr, TRUE) == 0) {
    DWORD error = GetLastError();
    if (error == ERROR_SUCCESS) error = ERROR_GEN_FAILURE;
    RecordRestoreError(result, "SetWindowRgn", error);
  }

  ShowWindow(state.child, SW_HIDE);

  HWND restoreParent = state.originalParent;
  if (restoreParent != nullptr && !IsWindow(restoreParent)) {
    RecordRestoreError(result, "original parent is no longer valid",
                       ERROR_INVALID_WINDOW_HANDLE);
    restoreParent = nullptr;
  }

  SetLastError(ERROR_SUCCESS);
  const HWND previousParent = SetParent(state.child, restoreParent);
  DWORD error = GetLastError();
  if (previousParent == nullptr && error != ERROR_SUCCESS) {
    RecordRestoreError(result, "SetParent", error);
  }

  SetLastError(ERROR_SUCCESS);
  const LONG_PTR previousStyle =
      SetWindowLongPtrW(state.child, GWL_STYLE, state.originalStyle);
  error = GetLastError();
  if (previousStyle == 0 && error != ERROR_SUCCESS) {
    RecordRestoreError(result, "restore GWL_STYLE", error);
  }

  SetLastError(ERROR_SUCCESS);
  const LONG_PTR previousExStyle =
      SetWindowLongPtrW(state.child, GWL_EXSTYLE, state.originalExStyle);
  error = GetLastError();
  if (previousExStyle == 0 && error != ERROR_SUCCESS) {
    RecordRestoreError(result, "restore GWL_EXSTYLE", error);
  }

  POINT position{state.originalScreenRect.left, state.originalScreenRect.top};
  if (restoreParent != nullptr && !ScreenToClient(restoreParent, &position)) {
    error = GetLastError();
    if (error == ERROR_SUCCESS) error = ERROR_GEN_FAILURE;
    RecordRestoreError(result, "ScreenToClient", error);
  }

  const HWND insertAfter =
      (state.originalExStyle & WS_EX_TOPMOST) != 0 ? HWND_TOPMOST
                                                  : HWND_NOTOPMOST;
  UINT flags = SWP_NOACTIVATE | SWP_FRAMECHANGED;
  flags |= state.originalVisible ? SWP_SHOWWINDOW : SWP_HIDEWINDOW;
  if (!SetWindowPos(state.child, insertAfter, position.x, position.y,
                    RectWidth(state.originalScreenRect),
                    RectHeight(state.originalScreenRect), flags)) {
    error = GetLastError();
    if (error == ERROR_SUCCESS) error = ERROR_GEN_FAILURE;
    RecordRestoreError(result, "SetWindowPos", error);
  }

  return result;
}

std::string AttachmentChangeReason(const AttachmentState& state,
                                   const Layout& layout) {
  if (state.taskbar != layout.taskbar) return "taskbar-replaced";
  if (state.dpi != layout.dpi) return "dpi-changed";
  if (state.cornerRadiusPx != layout.cornerRadiusPx) return "radius-changed";
  if (state.edge != layout.edge) return "edge-changed";
  if (!RectEquals(state.attachedScreenRect, layout.screenBounds)) {
    return "layout-changed";
  }
  if (GetParent(state.child) != layout.taskbar) return "parent-changed";

  const LONG_PTR currentStyle =
      GetWindowLongPtrChecked(state.child, GWL_STYLE);
  const LONG_PTR currentExStyle =
      GetWindowLongPtrChecked(state.child, GWL_EXSTYLE);
  if ((currentStyle & WS_CHILD) == 0 || (currentStyle & WS_POPUP) != 0 ||
      (currentExStyle & WS_EX_NOACTIVATE) == 0 ||
      (currentExStyle & WS_EX_TOOLWINDOW) == 0 ||
      (currentExStyle & (WS_EX_APPWINDOW | WS_EX_TRANSPARENT)) != 0) {
    return "style-changed";
  }

  if (!RectEquals(GetWindowRectChecked(state.child, "ERR_WINDOW_POSITION"),
                  layout.screenBounds)) {
    return "bounds-changed";
  }
  return {};
}

void ApplyAttachment(AttachmentState& state, const Layout& layout) {
  const LONG_PTR currentStyle =
      GetWindowLongPtrChecked(state.child, GWL_STYLE);
  const LONG_PTR currentExStyle =
      GetWindowLongPtrChecked(state.child, GWL_EXSTYLE);
  const LONG_PTR desiredStyle =
      (currentStyle & ~static_cast<LONG_PTR>(WS_POPUP)) | WS_CHILD;
  const LONG_PTR desiredExStyle =
      (currentExStyle | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW) &
      ~static_cast<LONG_PTR>(WS_EX_APPWINDOW | WS_EX_TRANSPARENT);

  if (currentStyle != desiredStyle) {
    SetWindowLongPtrChecked(state.child, GWL_STYLE, desiredStyle);
  }
  if (currentExStyle != desiredExStyle) {
    SetWindowLongPtrChecked(state.child, GWL_EXSTYLE, desiredExStyle);
  }

  if (GetParent(state.child) != layout.taskbar) {
    SetParentChecked(state.child, layout.taskbar);
  }

  if (GetWindowAwarenessChecked(state.child) !=
      GetWindowAwarenessChecked(layout.taskbar)) {
    throw AddonError(
        "ERR_DPI_AWARENESS_MISMATCH",
        "SetParent changed the Electron window DPI awareness unexpectedly.");
  }

  POINT parentPosition{layout.screenBounds.left, layout.screenBounds.top};
  SetLastError(ERROR_SUCCESS);
  if (!ScreenToClient(layout.taskbar, &parentPosition)) {
    ThrowWin32("ERR_WINDOW_POSITION", "ScreenToClient");
  }

  UINT flags = SWP_NOACTIVATE | SWP_FRAMECHANGED;
  if (IsWindowVisible(state.child)) flags |= SWP_SHOWWINDOW;
  if (!SetWindowPos(state.child, HWND_TOP, parentPosition.x, parentPosition.y,
                    RectWidth(layout.screenBounds),
                    RectHeight(layout.screenBounds), flags)) {
    ThrowWin32("ERR_WINDOW_POSITION", "SetWindowPos");
  }

  const int width = RectWidth(layout.screenBounds);
  const int height = RectHeight(layout.screenBounds);
  HRGN region = nullptr;
  if (layout.cornerRadiusPx > 0) {
    const int diameter = layout.cornerRadiusPx * 2;
    region = CreateRoundRectRgn(0, 0, width + 1, height + 1, diameter,
                                diameter);
  } else {
    region = CreateRectRgn(0, 0, width, height);
  }
  if (region == nullptr) {
    ThrowWin32("ERR_WINDOW_REGION", "CreateRoundRectRgn");
  }

  SetLastError(ERROR_SUCCESS);
  if (SetWindowRgn(state.child, region, TRUE) == 0) {
    const DWORD error = GetLastError();
    DeleteObject(region);
    ThrowWin32("ERR_WINDOW_REGION", "SetWindowRgn", error);
  }
  // SetWindowRgn transfers ownership of a successfully installed region to
  // the operating system. Do not delete it here.

  state.taskbar = layout.taskbar;
  state.attachedScreenRect = layout.screenBounds;
  state.dpi = layout.dpi;
  state.cornerRadiusPx = layout.cornerRadiusPx;
  state.edge = layout.edge;
}

napi_value CreateString(napi_env env, const std::string& value) {
  napi_value result;
  CheckNapi(env,
            napi_create_string_utf8(env, value.c_str(), value.size(), &result),
            "napi_create_string_utf8");
  return result;
}

void SetNamedProperty(napi_env env, napi_value object, const char* name,
                      napi_value value) {
  CheckNapi(env, napi_set_named_property(env, object, name, value),
            "napi_set_named_property");
}

napi_value CreateAttachResult(napi_env env, bool changed,
                              const Layout& layout,
                              const std::string& changeReason) {
  napi_value result;
  CheckNapi(env, napi_create_object(env, &result), "napi_create_object");

  napi_value changedValue;
  CheckNapi(env, napi_get_boolean(env, changed, &changedValue),
            "napi_get_boolean");
  SetNamedProperty(env, result, "changed", changedValue);
  SetNamedProperty(env, result, "changeReason",
                   CreateString(env, changeReason));
  SetNamedProperty(env, result, "edge", CreateString(env, layout.edge));

  napi_value dpiValue;
  CheckNapi(env, napi_create_uint32(env, layout.dpi, &dpiValue),
            "napi_create_uint32");
  SetNamedProperty(env, result, "dpi", dpiValue);

  napi_value bounds;
  CheckNapi(env, napi_create_object(env, &bounds), "napi_create_object");
  const struct {
    const char* name;
    int32_t value;
  } coordinates[] = {
      {"x", layout.screenBounds.left},
      {"y", layout.screenBounds.top},
      {"width", RectWidth(layout.screenBounds)},
      {"height", RectHeight(layout.screenBounds)},
  };
  for (const auto& coordinate : coordinates) {
    napi_value number;
    CheckNapi(env, napi_create_int32(env, coordinate.value, &number),
              "napi_create_int32");
    SetNamedProperty(env, bounds, coordinate.name, number);
  }
  SetNamedProperty(env, result, "boundsPx", bounds);
  SetNamedProperty(env, result, "taskbarClass",
                   CreateString(env, "Shell_TrayWnd"));
  return result;
}

napi_value AttachTaskbarWindow(napi_env env, napi_callback_info info) {
  try {
    size_t argc = 2;
    napi_value args[2];
    CheckNapi(env, napi_get_cb_info(env, info, &argc, args, nullptr, nullptr),
              "napi_get_cb_info");
    if (argc != 2) {
      throw AddonError(
          "ERR_INVALID_ARGUMENTS",
          "attachTaskbarWindow expects hwnd and options arguments.");
    }

    const HWND child = ParseOwnedWindowHandle(env, args[0]);
    const AttachOptions options = ParseOptions(env, args[1]);
    const Layout layout = CalculateLayout(child, options);

    std::lock_guard<std::mutex> lock(gAttachmentsMutex);
    auto existing = gAttachments.find(child);
    std::string changeReason = "initial-attach";
    if (existing != gAttachments.end()) {
      changeReason = AttachmentChangeReason(existing->second, layout);
      if (changeReason.empty()) {
        return CreateAttachResult(env, false, layout, changeReason);
      }
    }

    AttachmentState state;
    if (existing != gAttachments.end()) {
      state = existing->second;
    } else {
      state.child = child;
      state.originalParent = GetParent(child);
      state.originalStyle = GetWindowLongPtrChecked(child, GWL_STYLE);
      state.originalExStyle = GetWindowLongPtrChecked(child, GWL_EXSTYLE);
      state.originalScreenRect =
          GetWindowRectChecked(child, "ERR_WINDOW_POSITION");
      state.originalVisible = IsWindowVisible(child) != FALSE;
    }

    try {
      ApplyAttachment(state, layout);
    } catch (const AddonError& error) {
      const RestoreResult restore = RestoreOriginalWindow(state);
      gAttachments.erase(child);
      std::string message = error.what();
      if (!restore.ok) {
        message += "; rollback also failed: ";
        message += restore.errors;
      }
      throw AddonError(error.code, message);
    }

    gAttachments[child] = state;
    return CreateAttachResult(env, true, layout, changeReason);
  } catch (const AddonError& error) {
    napi_throw_error(env, error.code.c_str(), error.what());
  } catch (const std::exception& error) {
    napi_throw_error(env, "ERR_WINDOWS_TASKBAR_NATIVE", error.what());
  } catch (...) {
    napi_throw_error(env, "ERR_WINDOWS_TASKBAR_NATIVE",
                     "Unknown native taskbar error.");
  }
  return nullptr;
}

napi_value DetachTaskbarWindow(napi_env env, napi_callback_info info) {
  try {
    size_t argc = 1;
    napi_value args[1];
    CheckNapi(env, napi_get_cb_info(env, info, &argc, args, nullptr, nullptr),
              "napi_get_cb_info");
    if (argc != 1) {
      throw AddonError("ERR_INVALID_ARGUMENTS",
                       "detachTaskbarWindow expects one hwnd argument.");
    }

    const HWND child = ParseWindowHandleBuffer(env, args[0]);
    std::lock_guard<std::mutex> lock(gAttachmentsMutex);
    const auto existing = gAttachments.find(child);
    if (existing == gAttachments.end()) {
      ValidateOwnedWindowHandle(child);
      napi_value result;
      CheckNapi(env, napi_get_boolean(env, false, &result),
                "napi_get_boolean");
      return result;
    }

    if (!IsWindow(child)) {
      gAttachments.erase(existing);
      napi_value result;
      CheckNapi(env, napi_get_boolean(env, true, &result),
                "napi_get_boolean");
      return result;
    }
    ValidateOwnedWindowHandle(child);

    const AttachmentState state = existing->second;
    gAttachments.erase(existing);
    const RestoreResult restore = RestoreOriginalWindow(state);
    if (!restore.ok) {
      throw AddonError("ERR_DETACH_FAILED",
                       "Failed to fully restore the Electron window: " +
                           restore.errors);
    }

    napi_value result;
    CheckNapi(env, napi_get_boolean(env, true, &result), "napi_get_boolean");
    return result;
  } catch (const AddonError& error) {
    napi_throw_error(env, error.code.c_str(), error.what());
  } catch (const std::exception& error) {
    napi_throw_error(env, "ERR_WINDOWS_TASKBAR_NATIVE", error.what());
  } catch (...) {
    napi_throw_error(env, "ERR_WINDOWS_TASKBAR_NATIVE",
                     "Unknown native taskbar error.");
  }
  return nullptr;
}

napi_value SetTaskbarWindowVisible(napi_env env, napi_callback_info info) {
  try {
    size_t argc = 2;
    napi_value args[2];
    CheckNapi(env, napi_get_cb_info(env, info, &argc, args, nullptr, nullptr),
              "napi_get_cb_info");
    if (argc != 2) {
      throw AddonError(
          "ERR_INVALID_ARGUMENTS",
          "setTaskbarWindowVisible expects hwnd and visible arguments.");
    }

    const HWND child = ParseOwnedWindowHandle(env, args[0]);
    bool visible = false;
    CheckNapi(env, napi_get_value_bool(env, args[1], &visible),
              "napi_get_value_bool");

    std::lock_guard<std::mutex> lock(gAttachmentsMutex);
    const auto existing = gAttachments.find(child);
    if (existing == gAttachments.end() ||
        GetParent(child) != existing->second.taskbar) {
      throw AddonError("ERR_NOT_ATTACHED",
                       "The Electron window is not attached to the taskbar.");
    }

    ShowWindow(child, visible ? SW_SHOWNOACTIVATE : SW_HIDE);
    napi_value result;
    CheckNapi(env, napi_get_boolean(env, true, &result), "napi_get_boolean");
    return result;
  } catch (const AddonError& error) {
    napi_throw_error(env, error.code.c_str(), error.what());
  } catch (const std::exception& error) {
    napi_throw_error(env, "ERR_WINDOWS_TASKBAR_NATIVE", error.what());
  } catch (...) {
    napi_throw_error(env, "ERR_WINDOWS_TASKBAR_NATIVE",
                     "Unknown native taskbar error.");
  }
  return nullptr;
}

napi_value GetApiVersion(napi_env env, napi_callback_info /*info*/) {
  napi_value result;
  if (napi_create_uint32(env, kApiVersion, &result) != napi_ok) {
    napi_throw_error(env, "ERR_NAPI", "napi_create_uint32 failed.");
    return nullptr;
  }
  return result;
}

void CleanupAttachments(void* /*data*/) {
  std::vector<AttachmentState> attachments;
  {
    std::lock_guard<std::mutex> lock(gAttachmentsMutex);
    attachments.reserve(gAttachments.size());
    for (const auto& entry : gAttachments) attachments.push_back(entry.second);
    gAttachments.clear();
  }

  for (const AttachmentState& attachment : attachments) {
    RestoreOriginalWindow(attachment);
  }
}

napi_value Initialize(napi_env env, napi_value exports) {
  const napi_property_descriptor descriptors[] = {
      {"attachTaskbarWindow", nullptr, AttachTaskbarWindow, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"detachTaskbarWindow", nullptr, DetachTaskbarWindow, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"setTaskbarWindowVisible", nullptr, SetTaskbarWindowVisible, nullptr,
       nullptr, nullptr, napi_default, nullptr},
      {"getApiVersion", nullptr, GetApiVersion, nullptr, nullptr, nullptr,
       napi_default, nullptr},
  };

  if (napi_define_properties(
          env, exports, sizeof(descriptors) / sizeof(descriptors[0]),
          descriptors) != napi_ok) {
    napi_throw_error(env, "ERR_NAPI", "napi_define_properties failed.");
    return nullptr;
  }
  if (napi_add_env_cleanup_hook(env, CleanupAttachments, nullptr) != napi_ok) {
    napi_throw_error(env, "ERR_NAPI",
                     "napi_add_env_cleanup_hook failed.");
    return nullptr;
  }
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
