using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;

namespace LyricsAdapter.TaskbarLyrics;

internal enum MonitorSelectionKind
{
    Primary,
    Cursor,
    Index,
}

internal readonly record struct MonitorPreference(
    MonitorSelectionKind Kind,
    int Index)
{
    internal static MonitorPreference Parse(string[] arguments)
    {
        var option = arguments.FirstOrDefault(argument =>
            argument.StartsWith("--monitor=", StringComparison.OrdinalIgnoreCase));
        var value = option?["--monitor=".Length..].Trim();
        if (string.Equals(value, "cursor", StringComparison.OrdinalIgnoreCase))
        {
            return new MonitorPreference(MonitorSelectionKind.Cursor, 0);
        }

        if (int.TryParse(value, out var index) && index >= 0)
        {
            return new MonitorPreference(MonitorSelectionKind.Index, index);
        }

        return new MonitorPreference(MonitorSelectionKind.Primary, 0);
    }
}

internal readonly record struct TaskbarTarget(
    IntPtr Window,
    IntPtr Monitor,
    NativeRect Bounds,
    NativeRect MonitorBounds,
    NativeRect WorkArea,
    bool IsPrimary)
{
    internal bool IsHorizontal => Bounds.Width >= Bounds.Height;
}

internal readonly record struct MonitorTarget(
    IntPtr Monitor,
    NativeRect Bounds,
    NativeRect WorkArea);

internal sealed class TaskbarLocator
{
    private static readonly TimeSpan AutomationLookupDeadline = TimeSpan.FromMilliseconds(750);

    private static readonly string[] TaskbarClasses =
    [
        "Shell_TrayWnd",
        "Shell_SecondaryTrayWnd",
    ];

    private static readonly string[] NativeTrayClasses =
    [
        "TrayNotifyWnd",
        "SystemTray.NotifyIconOverflowWindow",
    ];

    private readonly object automationGate = new();
    private readonly Dictionary<IntPtr, NativeRect> automationAnchors = new();
    private readonly AutomationAnchorWorker automationWorker;
    private long automationGeneration;

    internal TaskbarLocator()
    {
        automationWorker = new AutomationAnchorWorker(CompleteAutomationLookup);
    }

    internal TaskbarTarget? FindTaskbar(MonitorPreference preference)
    {
        var taskbars = EnumerateTaskbars();
        if (taskbars.Count == 0)
        {
            return null;
        }

        if (preference.Kind == MonitorSelectionKind.Cursor
            && NativeMethods.GetCursorPos(out var cursor))
        {
            var cursorMonitor = NativeMethods.MonitorFromPoint(
                cursor,
                NativeMethods.MonitorDefaultToNearest);
            var cursorTaskbar = taskbars.FirstOrDefault(target => target.Monitor == cursorMonitor);
            if (cursorTaskbar.Window != IntPtr.Zero)
            {
                return cursorTaskbar;
            }
        }

        if (preference.Kind == MonitorSelectionKind.Index)
        {
            return taskbars[Math.Min(preference.Index, taskbars.Count - 1)];
        }

        var primary = taskbars.FirstOrDefault(target => target.IsPrimary);
        return primary.Window != IntPtr.Zero ? primary : taskbars[0];
    }

    internal MonitorTarget GetFallbackMonitor(MonitorPreference preference)
    {
        var point = new NativePoint(0, 0);
        if (preference.Kind == MonitorSelectionKind.Cursor)
        {
            _ = NativeMethods.GetCursorPos(out point);
        }

        var monitor = NativeMethods.MonitorFromPoint(
            point,
            preference.Kind == MonitorSelectionKind.Cursor
                ? NativeMethods.MonitorDefaultToNearest
                : NativeMethods.MonitorDefaultToPrimary);
        if (NativeMethods.TryGetMonitorInfo(monitor, out var information))
        {
            return new MonitorTarget(monitor, information.Monitor, information.WorkArea);
        }

        return new MonitorTarget(
            IntPtr.Zero,
            new NativeRect { Left = 0, Top = 0, Right = 1920, Bottom = 1080 },
            new NativeRect { Left = 0, Top = 0, Right = 1920, Bottom = 1040 });
    }

    internal NativeRect? TryGetTrayAnchor(TaskbarTarget target, Action anchorUpdated)
    {
        var nativeAnchor = FindNativeTrayAnchor(target.Window);
        if (nativeAnchor is { } native && Intersects(native, target.Bounds))
        {
            return native;
        }

        long generation;
        lock (automationGate)
        {
            if (automationAnchors.TryGetValue(target.Window, out var cached)
                && Intersects(cached, target.Bounds))
            {
                return cached;
            }
            generation = automationGeneration;
        }

        _ = automationWorker.TryStart(new AutomationLookupRequest(
            target.Window,
            generation,
            AutomationLookupDeadline,
            anchorUpdated));

        return null;
    }

    internal void Invalidate()
    {
        lock (automationGate)
        {
            automationGeneration++;
            automationAnchors.Clear();
        }
    }

    private void CompleteAutomationLookup(
        AutomationLookupRequest request,
        NativeRect? result,
        bool completedBeforeDeadline)
    {
        var accepted = false;
        lock (automationGate)
        {
            if (completedBeforeDeadline
                && result is { } anchor
                && request.Generation == automationGeneration)
            {
                automationAnchors[request.Window] = anchor;
                accepted = true;
            }
        }

        if (accepted)
        {
            request.AnchorUpdated();
        }
    }

    private static List<TaskbarTarget> EnumerateTaskbars()
    {
        var taskbars = new List<TaskbarTarget>();
        NativeMethods.EnumWindows((window, _) =>
        {
            var className = GetClassName(window);
            if (!TaskbarClasses.Contains(className, StringComparer.Ordinal))
            {
                return true;
            }

            if (!NativeMethods.GetWindowRect(window, out var bounds) || bounds.IsEmpty)
            {
                return true;
            }

            var monitor = NativeMethods.MonitorFromWindow(
                window,
                NativeMethods.MonitorDefaultToNearest);
            if (!NativeMethods.TryGetMonitorInfo(monitor, out var information))
            {
                return true;
            }

            taskbars.Add(new TaskbarTarget(
                window,
                monitor,
                bounds,
                information.Monitor,
                information.WorkArea,
                (information.Flags & NativeMethods.MonitorInfoPrimary) != 0));
            return true;
        }, IntPtr.Zero);

        return taskbars
            .OrderByDescending(target => target.IsPrimary)
            .ThenBy(target => target.MonitorBounds.Left)
            .ThenBy(target => target.MonitorBounds.Top)
            .ToList();
    }

    private static NativeRect? FindNativeTrayAnchor(IntPtr taskbar)
    {
        NativeRect? result = null;
        NativeMethods.EnumChildWindows(taskbar, (window, _) =>
        {
            if (!NativeTrayClasses.Contains(GetClassName(window), StringComparer.Ordinal))
            {
                return true;
            }

            if (NativeMethods.GetWindowRect(window, out var rectangle) && !rectangle.IsEmpty)
            {
                result = rectangle;
                return false;
            }

            return true;
        }, IntPtr.Zero);
        return result;
    }

    private static NativeRect? FindAutomationTrayAnchor(IntPtr taskbar)
    {
        try
        {
            var root = AutomationElement.FromHandle(taskbar);
            var condition = new OrCondition(
                new PropertyCondition(AutomationElement.AutomationIdProperty, "SystemTrayIcon"),
                new PropertyCondition(AutomationElement.AutomationIdProperty, "SystemTrayFrameGrid"));
            var element = root.FindFirst(TreeScope.Descendants, condition);
            if (element is null)
            {
                return null;
            }

            var rectangle = element.Current.BoundingRectangle;
            if (rectangle.IsEmpty
                || !double.IsFinite(rectangle.Left)
                || !double.IsFinite(rectangle.Top)
                || !double.IsFinite(rectangle.Right)
                || !double.IsFinite(rectangle.Bottom))
            {
                return null;
            }

            return new NativeRect
            {
                Left = (int)Math.Round(rectangle.Left),
                Top = (int)Math.Round(rectangle.Top),
                Right = (int)Math.Round(rectangle.Right),
                Bottom = (int)Math.Round(rectangle.Bottom),
            };
        }
        catch (Exception exception)
            when (exception is ElementNotAvailableException
                or InvalidOperationException
                or COMException)
        {
            return null;
        }
    }

    private static string GetClassName(IntPtr window)
    {
        var className = new StringBuilder(256);
        return NativeMethods.GetClassName(window, className, className.Capacity) > 0
            ? className.ToString()
            : string.Empty;
    }

    private static bool Intersects(NativeRect first, NativeRect second)
    {
        return first.Left < second.Right
            && first.Right > second.Left
            && first.Top < second.Bottom
            && first.Bottom > second.Top;
    }

    private readonly record struct AutomationLookupRequest(
        IntPtr Window,
        long Generation,
        TimeSpan Timeout,
        Action AnchorUpdated);

    /// <summary>
    /// UI Automation providers are cross-process COM servers and may stop
    /// responding. A single dedicated background thread means a wedged Explorer
    /// provider can consume at most one thread and can never create an unbounded
    /// queue of ThreadPool work. Late results are discarded by deadline and
    /// generation; an in-flight lookup deliberately survives Invalidate().
    /// </summary>
    private sealed class AutomationAnchorWorker
    {
        private readonly object gate = new();
        private readonly AutoResetEvent wake = new(false);
        private readonly Action<AutomationLookupRequest, NativeRect?, bool> completed;
        private AutomationLookupRequest? pending;
        private bool busy;

        internal AutomationAnchorWorker(
            Action<AutomationLookupRequest, NativeRect?, bool> completed)
        {
            this.completed = completed;
            var thread = new Thread(Run)
            {
                IsBackground = true,
                Name = "LyricsAdapter taskbar UI Automation",
            };
            thread.SetApartmentState(ApartmentState.MTA);
            thread.Start();
        }

        internal bool TryStart(AutomationLookupRequest request)
        {
            lock (gate)
            {
                if (busy)
                {
                    return false;
                }

                busy = true;
                pending = request;
                wake.Set();
                return true;
            }
        }

        private void Run()
        {
            while (true)
            {
                wake.WaitOne();
                AutomationLookupRequest request;
                lock (gate)
                {
                    if (pending is not { } queued)
                    {
                        busy = false;
                        continue;
                    }

                    request = queued;
                    pending = null;
                }

                NativeRect? result = null;
                var stopwatch = Stopwatch.StartNew();
                try
                {
                    result = FindAutomationTrayAnchor(request.Window);
                }
                catch (Exception exception)
                {
                    Diagnostics.Write($"UI Automation lookup failed: {exception.Message}");
                }

                var completedBeforeDeadline = stopwatch.Elapsed <= request.Timeout;
                lock (gate)
                {
                    busy = false;
                }

                try
                {
                    completed(request, result, completedBeforeDeadline);
                }
                catch (Exception exception)
                {
                    Diagnostics.Write($"UI Automation completion failed: {exception.Message}");
                }
            }
        }
    }
}
