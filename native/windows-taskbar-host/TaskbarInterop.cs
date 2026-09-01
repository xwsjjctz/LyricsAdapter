using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace LyricsAdapter.TaskbarHost;

internal sealed class TaskbarLayout
{
    internal required IntPtr Taskbar { get; init; }
    internal required int CanvasX { get; init; }
    internal required int CanvasY { get; init; }
    internal required int CanvasWidth { get; init; }
    internal required int CanvasHeight { get; init; }
    internal required int X { get; init; }
    internal required int Y { get; init; }
    internal required int Width { get; init; }
    internal required int Height { get; init; }
    internal required int CornerRadius { get; init; }
    internal required uint Dpi { get; init; }
    internal required string Edge { get; init; }
}

internal static class TaskbarInterop
{
    private const string PrimaryTaskbarClass = "Shell_TrayWnd";
    private const string TrayNotifyClass = "TrayNotifyWnd";

    private const int GwlStyle = -16;
    private const int GwlExStyle = -20;
    private const long WsChild = 0x40000000L;
    private const long WsPopup = unchecked((long)0x80000000L);
    private const long WsExTransparent = 0x00000020L;
    private const long WsExTopmost = 0x00000008L;
    private const long WsExToolWindow = 0x00000080L;
    private const long WsExAppWindow = 0x00040000L;
    private const long WsExNoActivate = 0x08000000L;

    private const uint SwpNoSize = 0x0001;
    private const uint SwpNoMove = 0x0002;
    private const uint SwpNoZOrder = 0x0004;
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpFrameChanged = 0x0020;
    private const uint SwpShowWindow = 0x0040;
    private const uint SwpAsyncWindowPos = 0x4000;
    private const int SwHide = 0;
    private const int SwShowNoActivate = 4;
    private static readonly IntPtr HwndTop = IntPtr.Zero;
    private static readonly IntPtr HwndTopMost = new(-1);

    /// <summary>
    /// Establishes the topmost band while the WPF HWND is still top-level.
    /// Windows 11's taskbar composition children can otherwise paint above a
    /// correctly parented and visible window. SetParent preserves this band.
    /// </summary>
    internal static void SetTopmost(IntPtr window)
    {
        if (window == IntPtr.Zero || !IsWindow(window))
        {
            throw new InvalidOperationException("Taskbar lyrics HWND is unavailable.");
        }
        if (!SetWindowPos(
                window,
                HwndTopMost,
                0,
                0,
                0,
                0,
                SwpNoMove | SwpNoSize | SwpNoActivate))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Topmost taskbar band failed.");
        }
    }

    internal static bool TryCalculateLayout(
        double desiredWidthDip,
        double minimumWidthDip,
        double heightDip,
        double gapDip,
        double cornerRadiusDip,
        out TaskbarLayout? layout,
        out string reason)
    {
        layout = null;
        reason = string.Empty;

        var taskbar = FindWindow(PrimaryTaskbarClass, null);
        if (taskbar == IntPtr.Zero || !IsWindow(taskbar))
        {
            reason = "primary-taskbar-unavailable";
            return false;
        }
        if (!GetWindowRect(taskbar, out var taskbarRect))
        {
            reason = "taskbar-bounds-unavailable";
            return false;
        }

        var taskbarWidth = taskbarRect.Right - taskbarRect.Left;
        var taskbarHeight = taskbarRect.Bottom - taskbarRect.Top;
        if (taskbarWidth <= 0 || taskbarHeight <= 0)
        {
            reason = "taskbar-bounds-invalid";
            return false;
        }
        if (taskbarHeight >= taskbarWidth)
        {
            reason = "vertical-taskbar-unsupported";
            return false;
        }

        var dpi = GetDpiForWindow(taskbar);
        if (dpi == 0)
        {
            reason = "taskbar-dpi-unavailable";
            return false;
        }

        var desiredWidth = DipToPixels(desiredWidthDip, dpi);
        var minimumWidth = DipToPixels(minimumWidthDip, dpi);
        var height = DipToPixels(heightDip, dpi);
        var gap = DipToPixels(gapDip, dpi);
        if (height <= 0 || height > taskbarHeight)
        {
            reason = "taskbar-too-small";
            return false;
        }

        var tray = FindDescendantByClass(taskbar, TrayNotifyClass);
        var width = desiredWidth;
        var x = 0;
        if (tray != IntPtr.Zero && GetWindowRect(tray, out var trayRect))
        {
            var taskbarCenter = taskbarRect.Left + taskbarWidth / 2;
            var trayCenter = trayRect.Left + (trayRect.Right - trayRect.Left) / 2;
            if (trayCenter >= taskbarCenter)
            {
                var available = trayRect.Left - taskbarRect.Left - gap * 2;
                width = Math.Min(desiredWidth, available);
                x = trayRect.Left - gap - width;
            }
            else
            {
                var available = taskbarRect.Right - trayRect.Right - gap * 2;
                width = Math.Min(desiredWidth, available);
                x = trayRect.Right + gap;
            }
        }
        else
        {
            // Explorer variants occasionally hide TrayNotifyWnd. Keep a system
            // tray-sized reserve and recover automatically on the next health tick.
            var trayReserve = DipToPixels(220, dpi);
            var available = Math.Max(0, taskbarWidth - trayReserve - gap * 2);
            width = Math.Min(desiredWidth, available);
            x = taskbarRect.Right - trayReserve - gap - width;
        }

        if (width < minimumWidth
            || x < taskbarRect.Left
            || x + width > taskbarRect.Right)
        {
            reason = "taskbar-has-no-safe-space";
            return false;
        }

        var y = taskbarRect.Top + (taskbarHeight - height) / 2;
        var edge = "bottom";
        var monitor = MonitorFromWindow(taskbar, 0);
        if (monitor != IntPtr.Zero)
        {
            var monitorInfo = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
            if (GetMonitorInfo(monitor, ref monitorInfo))
            {
                var topDistance = Math.Abs(taskbarRect.Top - monitorInfo.Monitor.Top);
                var bottomDistance = Math.Abs(monitorInfo.Monitor.Bottom - taskbarRect.Bottom);
                edge = topDistance <= bottomDistance ? "top" : "bottom";
            }
        }

        layout = new TaskbarLayout
        {
            Taskbar = taskbar,
            CanvasX = taskbarRect.Left,
            CanvasY = taskbarRect.Top,
            CanvasWidth = taskbarWidth,
            CanvasHeight = taskbarHeight,
            X = x,
            Y = y,
            Width = width,
            Height = height,
            CornerRadius = Math.Clamp(
                DipToPixels(cornerRadiusDip, dpi),
                0,
                Math.Min(width, height) / 2),
            Dpi = dpi,
            Edge = edge,
        };
        return true;
    }

    internal static void ApplyLayout(
        IntPtr window,
        TaskbarLayout layout,
        bool visible)
    {
        if (window == IntPtr.Zero || !IsWindow(window))
        {
            throw new InvalidOperationException("Taskbar lyrics HWND is unavailable.");
        }

        var style = GetWindowLongPtr(window, GwlStyle).ToInt64();
        var desiredStyle = (style & ~WsPopup) | WsChild;
        if (style != desiredStyle)
        {
            SetWindowLongPtrChecked(window, GwlStyle, new IntPtr(desiredStyle));
        }

        var exStyle = GetWindowLongPtr(window, GwlExStyle).ToInt64();
        var desiredExStyle = (exStyle | WsExTopmost | WsExNoActivate | WsExToolWindow)
            & ~(WsExAppWindow | WsExTransparent);
        if (exStyle != desiredExStyle)
        {
            SetWindowLongPtrChecked(window, GwlExStyle, new IntPtr(desiredExStyle));
        }

        if (GetParent(window) != layout.Taskbar)
        {
            SetLastError(0);
            var previousParent = SetParent(window, layout.Taskbar);
            var error = Marshal.GetLastWin32Error();
            if (previousParent == IntPtr.Zero && error != 0)
            {
                throw new Win32Exception(error, "SetParent failed.");
            }
        }

        // Match FluentFlyout's composition model: the WPF child covers the
        // complete taskbar and its window region exposes only the widget. A
        // small layered child can have valid alpha and HWND hit testing while
        // Windows 11's DirectComposition taskbar still omits it visually.
        var parentPosition = new Point { X = layout.CanvasX, Y = layout.CanvasY };
        if (!ScreenToClient(layout.Taskbar, ref parentPosition))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "ScreenToClient failed.");
        }

        // Preserve the topmost band established before SetParent. Replacing it
        // with HWND_TOP here makes the WPF surface report visible while being
        // painted underneath Windows 11's taskbar composition layer.
        var flags = SwpNoZOrder | SwpNoActivate | SwpFrameChanged | SwpAsyncWindowPos;
        if (visible) flags |= SwpShowWindow;
        if (!SetWindowPos(
                window,
                HwndTop,
                parentPosition.X,
                parentPosition.Y,
                layout.CanvasWidth,
                layout.CanvasHeight,
                flags))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "SetWindowPos failed.");
        }

        var widgetX = layout.X - layout.CanvasX;
        var widgetY = layout.Y - layout.CanvasY;
        var diameter = layout.CornerRadius * 2;
        var region = diameter > 0
            ? CreateRoundRectRgn(
                widgetX,
                widgetY,
                widgetX + layout.Width + 1,
                widgetY + layout.Height + 1,
                diameter,
                diameter)
            : CreateRectRgn(
                widgetX,
                widgetY,
                widgetX + layout.Width,
                widgetY + layout.Height);
        if (region == IntPtr.Zero)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Window region creation failed.");
        }
        if (SetWindowRgn(window, region, true) == 0)
        {
            var error = Marshal.GetLastWin32Error();
            DeleteObject(region);
            throw new Win32Exception(error, "SetWindowRgn failed.");
        }

        ShowWindow(window, visible ? SwShowNoActivate : SwHide);
    }

    internal static void SetVisible(IntPtr window, bool visible)
    {
        if (window != IntPtr.Zero && IsWindow(window))
        {
            ShowWindow(window, visible ? SwShowNoActivate : SwHide);
        }
    }

    internal static bool IsWindowAvailable(IntPtr window)
    {
        return window != IntPtr.Zero && IsWindow(window);
    }

    internal static bool IsTopmost(IntPtr window)
    {
        return IsWindowAvailable(window)
            && (GetWindowLongPtr(window, GwlExStyle).ToInt64() & WsExTopmost) != 0;
    }

    internal static bool IsCurrentLayout(IntPtr window, TaskbarLayout layout)
    {
        if (window == IntPtr.Zero || !IsWindow(window)) return false;
        if (GetParent(window) != layout.Taskbar || !IsTopmost(window)) return false;
        if (!GetWindowRect(window, out var current)) return false;
        return current.Left == layout.CanvasX
            && current.Top == layout.CanvasY
            && current.Right - current.Left == layout.CanvasWidth
            && current.Bottom - current.Top == layout.CanvasHeight;
    }

    internal static uint GetAccentColor()
    {
        return DwmGetColorizationColor(out var color, out _) == 0
            ? color
            : 0xFF60CDFF;
    }

    private static IntPtr FindDescendantByClass(IntPtr parent, string className)
    {
        var found = IntPtr.Zero;
        EnumChildWindows(parent, (window, _) =>
        {
            var buffer = new StringBuilder(128);
            if (GetClassName(window, buffer, buffer.Capacity) > 0
                && string.Equals(buffer.ToString(), className, StringComparison.Ordinal))
            {
                found = window;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    private static int DipToPixels(double value, uint dpi)
    {
        return (int)Math.Round(value * dpi / 96d, MidpointRounding.AwayFromZero);
    }

    private static void SetWindowLongPtrChecked(IntPtr window, int index, IntPtr value)
    {
        SetLastError(0);
        var previous = SetWindowLongPtr(window, index, value);
        var error = Marshal.GetLastWin32Error();
        if (previous == IntPtr.Zero && error != 0)
        {
            throw new Win32Exception(error, "SetWindowLongPtr failed.");
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        internal int Left;
        internal int Top;
        internal int Right;
        internal int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        internal int X;
        internal int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MonitorInfo
    {
        internal int Size;
        internal Rect Monitor;
        internal Rect WorkArea;
        internal uint Flags;
    }

    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr FindWindow(string className, string? windowName);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr window, out Rect rect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumChildWindows(
        IntPtr parent,
        EnumWindowsCallback callback,
        IntPtr parameter);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(
        IntPtr window,
        StringBuilder className,
        int maximumCount);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", ExactSpelling = true, SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr(IntPtr window, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", ExactSpelling = true, SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetParent(IntPtr child, IntPtr newParent);

    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr window);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ScreenToClient(IntPtr window, ref Point point);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(
        IntPtr window,
        IntPtr insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern IntPtr CreateRoundRectRgn(
        int left,
        int top,
        int right,
        int bottom,
        int ellipseWidth,
        int ellipseHeight);

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int SetWindowRgn(IntPtr window, IntPtr region, bool redraw);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeleteObject(IntPtr value);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetColorizationColor(
        out uint colorizationColor,
        [MarshalAs(UnmanagedType.Bool)] out bool opaqueBlend);

    [DllImport("kernel32.dll")]
    private static extern void SetLastError(uint errorCode);
}
