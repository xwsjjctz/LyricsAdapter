using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;

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
    internal required string PlacementMode { get; init; }
    internal double? ManualPosition { get; init; }
    internal required bool PlacementAdjusted { get; init; }
    internal required int OccupiedRegionCount { get; init; }
}

internal static class TaskbarInterop
{
    private const string PrimaryTaskbarClass = "Shell_TrayWnd";
    private const string TrayNotifyClass = "TrayNotifyWnd";
    private const string RebarClass = "ReBarWindow32";
    private const int DwmwaCloaked = 14;

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
    private static readonly TimeSpan AutomationCacheDuration = TimeSpan.FromSeconds(3);
    private static IntPtr _automationCacheTaskbar;
    private static DateTime _automationCacheExpiresUtc = DateTime.MinValue;
    private static List<HorizontalInterval> _automationCache = [];

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
        IntPtr hostWindow,
        double? manualPosition,
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

        var innerStart = taskbarRect.Left + gap;
        var innerEnd = taskbarRect.Right - gap;
        if (innerEnd - innerStart < minimumWidth)
        {
            reason = "taskbar-has-no-safe-space";
            return false;
        }

        var occupied = CollectOccupiedIntervals(
            taskbar,
            hostWindow,
            taskbarRect);
        var taskbarCenter = taskbarRect.Left + taskbarWidth / 2;
        var preferEnd = true;
        var tray = FindDescendantByClass(taskbar, TrayNotifyClass);
        if (tray != IntPtr.Zero && GetWindowRect(tray, out var trayRect))
        {
            AddProjectedInterval(occupied, trayRect, taskbarRect);
            var trayCenter = trayRect.Left + (trayRect.Right - trayRect.Left) / 2;
            preferEnd = trayCenter >= taskbarCenter;
        }
        else
        {
            // Explorer variants occasionally hide TrayNotifyWnd. Reserve the
            // conventional notification area until its HWND becomes available.
            var trayReserve = Math.Min(
                DipToPixels(220, dpi),
                Math.Max(0, taskbarWidth - minimumWidth - gap * 2));
            occupied.Add(new HorizontalInterval(
                taskbarRect.Right - trayReserve,
                taskbarRect.Right));
        }

        var rebar = FindDescendantByClass(taskbar, RebarClass);
        if (rebar != IntPtr.Zero && GetWindowRect(rebar, out var rebarRect))
        {
            AddProjectedInterval(occupied, rebarRect, taskbarRect);
        }

        var mergedOccupied = MergeOccupiedIntervals(
            occupied,
            innerStart,
            innerEnd,
            gap);
        var freeIntervals = BuildFreeIntervals(
            mergedOccupied,
            innerStart,
            innerEnd);
        double? normalizedManualPosition = manualPosition is double requestedPosition
            && double.IsFinite(requestedPosition)
            ? Math.Clamp(requestedPosition, 0d, 1d)
            : null;
        if (!TrySelectPlacement(
                freeIntervals,
                desiredWidth,
                minimumWidth,
                taskbarRect.Left,
                taskbarWidth,
                normalizedManualPosition,
                preferEnd,
                out var x,
                out var width,
                out var placementAdjusted))
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
            PlacementMode = normalizedManualPosition.HasValue ? "manual" : "auto",
            ManualPosition = normalizedManualPosition,
            PlacementAdjusted = placementAdjusted,
            OccupiedRegionCount = mergedOccupied.Count,
        };
        return true;
    }

    private static List<HorizontalInterval> CollectOccupiedIntervals(
        IntPtr taskbar,
        IntPtr hostWindow,
        Rect taskbarRect)
    {
        var occupied = new List<HorizontalInterval>();
        occupied.AddRange(GetAutomationOccupiedIntervals(taskbar, taskbarRect));

        GetWindowThreadProcessId(taskbar, out var explorerProcessId);
        var hostProcessId = (uint)Environment.ProcessId;
        var inspected = new HashSet<IntPtr>();

        void InspectWindow(IntPtr window)
        {
            if (window == IntPtr.Zero
                || window == taskbar
                || window == hostWindow
                || !inspected.Add(window)
                || !IsWindowVisible(window)
                || IsWindowCloaked(window))
            {
                return;
            }

            GetWindowThreadProcessId(window, out var processId);
            if (processId == 0
                || processId == explorerProcessId
                || processId == hostProcessId)
            {
                return;
            }

            if (GetWindowRect(window, out var windowRect))
            {
                AddProjectedInterval(occupied, windowRect, taskbarRect);
            }
        }

        EnumWindows((window, _) =>
        {
            InspectWindow(window);
            return true;
        }, IntPtr.Zero);
        EnumChildWindows(taskbar, (window, _) =>
        {
            InspectWindow(window);
            return true;
        }, IntPtr.Zero);

        return occupied;
    }

    private static IReadOnlyList<HorizontalInterval> GetAutomationOccupiedIntervals(
        IntPtr taskbar,
        Rect taskbarRect)
    {
        var now = DateTime.UtcNow;
        if (_automationCacheTaskbar == taskbar && now < _automationCacheExpiresUtc)
        {
            return _automationCache;
        }

        var occupied = new List<HorizontalInterval>();
        try
        {
            var root = AutomationElement.FromHandle(taskbar);
            if (root is not null)
            {
                var condition = new OrCondition(
                    new PropertyCondition(
                        AutomationElement.ControlTypeProperty,
                        ControlType.Button),
                    new PropertyCondition(
                        AutomationElement.ControlTypeProperty,
                        ControlType.Pane));
                var elements = root.FindAll(TreeScope.Descendants, condition);
                var taskbarWidth = taskbarRect.Right - taskbarRect.Left;
                for (var index = 0; index < elements.Count; index++)
                {
                    try
                    {
                        var current = elements[index].Current;
                        var bounds = current.BoundingRectangle;
                        if (bounds.IsEmpty
                            || !double.IsFinite(bounds.Left)
                            || !double.IsFinite(bounds.Top)
                            || !double.IsFinite(bounds.Right)
                            || !double.IsFinite(bounds.Bottom))
                        {
                            continue;
                        }

                        var isButton = current.ControlType == ControlType.Button;
                        var width = bounds.Right - bounds.Left;
                        var className = current.ClassName;
                        var isTaskbarContainer = string.Equals(
                                className,
                                "Windows.UI.Input.InputSite.WindowClass",
                                StringComparison.Ordinal)
                            || string.Equals(
                                className,
                                "Taskbar.TaskbarFrameAutomationPeer",
                                StringComparison.Ordinal);
                        if (!isButton && (isTaskbarContainer || width >= taskbarWidth * 0.8))
                        {
                            // TaskbarFrame and InputSite span the whole bar and
                            // are containers rather than occupied visual slots.
                            continue;
                        }

                        AddProjectedInterval(occupied, new Rect
                        {
                            Left = (int)Math.Floor(bounds.Left),
                            Top = (int)Math.Floor(bounds.Top),
                            Right = (int)Math.Ceiling(bounds.Right),
                            Bottom = (int)Math.Ceiling(bounds.Bottom),
                        }, taskbarRect);
                    }
                    catch (ElementNotAvailableException)
                    {
                        // Explorer rebuilt this automation element mid-query.
                    }
                    catch (InvalidOperationException)
                    {
                        // A third-party taskbar provider returned stale data.
                    }
                    catch (COMException)
                    {
                        // An out-of-process automation provider disappeared.
                    }
                }
            }

            _automationCacheTaskbar = taskbar;
            _automationCache = occupied;
            _automationCacheExpiresUtc = now + AutomationCacheDuration;
        }
        catch (Exception)
        {
            // UI Automation is advisory. Native taskbar and third-party HWNDs
            // still provide a collision-safe fallback on customized shells.
            if (_automationCacheTaskbar != taskbar)
            {
                _automationCacheTaskbar = taskbar;
                _automationCache = [];
            }
            _automationCacheExpiresUtc = now + TimeSpan.FromSeconds(1);
        }

        return _automationCache;
    }

    private static void AddProjectedInterval(
        ICollection<HorizontalInterval> intervals,
        Rect candidate,
        Rect taskbar)
    {
        var overlapTop = Math.Max(candidate.Top, taskbar.Top);
        var overlapBottom = Math.Min(candidate.Bottom, taskbar.Bottom);
        var taskbarHeight = taskbar.Bottom - taskbar.Top;
        var minimumVerticalOverlap = Math.Max(2, taskbarHeight / 4);
        if (overlapBottom - overlapTop < minimumVerticalOverlap) return;

        var start = Math.Max(candidate.Left, taskbar.Left);
        var end = Math.Min(candidate.Right, taskbar.Right);
        if (end - start < 2) return;
        intervals.Add(new HorizontalInterval(start, end));
    }

    private static List<HorizontalInterval> MergeOccupiedIntervals(
        IEnumerable<HorizontalInterval> occupied,
        int innerStart,
        int innerEnd,
        int gap)
    {
        var clipped = occupied
            .Select(interval => new HorizontalInterval(
                Math.Max(innerStart, interval.Start - gap),
                Math.Min(innerEnd, interval.End + gap)))
            .Where(interval => interval.End > interval.Start)
            .OrderBy(interval => interval.Start)
            .ThenBy(interval => interval.End)
            .ToList();
        if (clipped.Count == 0) return [];

        var merged = new List<HorizontalInterval>();
        var current = clipped[0];
        for (var index = 1; index < clipped.Count; index++)
        {
            var next = clipped[index];
            if (next.Start <= current.End)
            {
                current = new HorizontalInterval(
                    current.Start,
                    Math.Max(current.End, next.End));
                continue;
            }
            merged.Add(current);
            current = next;
        }
        merged.Add(current);
        return merged;
    }

    private static List<HorizontalInterval> BuildFreeIntervals(
        IReadOnlyList<HorizontalInterval> occupied,
        int innerStart,
        int innerEnd)
    {
        var free = new List<HorizontalInterval>();
        var cursor = innerStart;
        foreach (var interval in occupied)
        {
            if (interval.Start > cursor)
            {
                free.Add(new HorizontalInterval(cursor, interval.Start));
            }
            cursor = Math.Max(cursor, interval.End);
        }
        if (cursor < innerEnd)
        {
            free.Add(new HorizontalInterval(cursor, innerEnd));
        }
        return free;
    }

    private static bool TrySelectPlacement(
        IReadOnlyList<HorizontalInterval> free,
        int desiredWidth,
        int minimumWidth,
        int taskbarLeft,
        int taskbarWidth,
        double? manualPosition,
        bool preferEnd,
        out int x,
        out int width,
        out bool adjusted)
    {
        x = 0;
        width = 0;
        adjusted = false;

        var minimumCandidates = free
            .Where(interval => interval.Length >= minimumWidth)
            .ToList();
        if (minimumCandidates.Count == 0) return false;

        if (manualPosition is double normalizedPosition)
        {
            var targetCenter = taskbarLeft
                + (int)Math.Round(taskbarWidth * normalizedPosition);
            var bestDistance = long.MaxValue;
            var bestWidth = -1;
            foreach (var interval in minimumCandidates)
            {
                var candidateWidth = Math.Min(desiredWidth, interval.Length);
                var candidateX = Math.Clamp(
                    targetCenter - candidateWidth / 2,
                    interval.Start,
                    interval.End - candidateWidth);
                var distance = Math.Abs((long)candidateX + candidateWidth / 2 - targetCenter);
                if (distance > bestDistance
                    || (distance == bestDistance && candidateWidth <= bestWidth))
                {
                    continue;
                }
                bestDistance = distance;
                bestWidth = candidateWidth;
                x = candidateX;
                width = candidateWidth;
            }
            adjusted = bestDistance > 1;
            return width >= minimumWidth;
        }

        var fullSize = minimumCandidates
            .Where(interval => interval.Length >= desiredWidth)
            .ToList();
        var candidates = fullSize.Count > 0 ? fullSize : minimumCandidates;
        var selected = preferEnd
            ? candidates.OrderByDescending(interval => interval.End)
                .ThenByDescending(interval => interval.Length)
                .First()
            : candidates.OrderBy(interval => interval.Start)
                .ThenByDescending(interval => interval.Length)
                .First();
        width = Math.Min(desiredWidth, selected.Length);
        x = preferEnd ? selected.End - width : selected.Start;
        return width >= minimumWidth;
    }

    private static bool IsWindowCloaked(IntPtr window)
    {
        return DwmGetWindowAttribute(
            window,
            DwmwaCloaked,
            out var cloaked,
            Marshal.SizeOf<int>()) == 0 && cloaked != 0;
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

    private readonly record struct HorizontalInterval(int Start, int End)
    {
        internal int Length => End - Start;
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

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(
        EnumWindowsCallback callback,
        IntPtr parameter);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(
        IntPtr window,
        out uint processId);

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

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(
        IntPtr window,
        int attribute,
        out int value,
        int valueSize);

    [DllImport("kernel32.dll")]
    private static extern void SetLastError(uint errorCode);
}
