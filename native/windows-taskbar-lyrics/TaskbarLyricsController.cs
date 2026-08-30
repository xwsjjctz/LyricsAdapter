using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;

namespace LyricsAdapter.TaskbarLyrics;

internal sealed class TaskbarLyricsController : IDisposable
{
    private const int WmDisplayChange = 0x007E;
    private const int WmSettingChange = 0x001A;
    private const int WmDeviceChange = 0x0219;
    private const int HiddenWindowStyle = unchecked((int)0x80000000);

    private readonly Application application;
    private readonly Dispatcher dispatcher;
    private readonly MonitorPreference monitorPreference;
    private readonly TaskbarLocator taskbarLocator = new();
    private readonly DispatcherTimer refreshTimer;
    private readonly CancellationTokenSource cancellation = new();
    private readonly uint taskbarCreatedMessage;
    private HwndSource? messageWindow;
    private LyricsWidgetWindow? widget;
    private LyricsState? state;
    private IntPtr attachedTaskbar;
    private IntPtr lastAttachFailure;
    private bool disposed;

    internal TaskbarLyricsController(
        Application application,
        Dispatcher dispatcher,
        MonitorPreference monitorPreference)
    {
        this.application = application;
        this.dispatcher = dispatcher;
        this.monitorPreference = monitorPreference;
        taskbarCreatedMessage = NativeMethods.RegisterWindowMessage("TaskbarCreated");
        refreshTimer = new DispatcherTimer(
            TimeSpan.FromMilliseconds(1_250),
            DispatcherPriority.Background,
            (_, _) => RefreshHost(),
            dispatcher);
    }

    internal void Start()
    {
        var parameters = new HwndSourceParameters("LyricsAdapter.TaskbarLyrics.Controller")
        {
            WindowStyle = HiddenWindowStyle,
            ExtendedWindowStyle = (int)(NativeMethods.WsExToolWindow | NativeMethods.WsExNoActivate),
            PositionX = -32_000,
            PositionY = -32_000,
            Width = 1,
            Height = 1,
        };
        messageWindow = new HwndSource(parameters);
        messageWindow.AddHook(MessageWindowProcedure);
        refreshTimer.Start();
        _ = Task.Run(ReadInputAsync);
    }

    public void Dispose()
    {
        if (disposed)
        {
            return;
        }

        disposed = true;
        cancellation.Cancel();
        refreshTimer.Stop();
        if (messageWindow is not null)
        {
            messageWindow.RemoveHook(MessageWindowProcedure);
            messageWindow.Dispose();
            messageWindow = null;
        }

        if (widget is not null)
        {
            try
            {
                widget.Close();
            }
            catch (InvalidOperationException)
            {
                // Explorer may already have destroyed the cross-process child HWND.
            }
            widget = null;
        }

        cancellation.Dispose();
    }

    private async Task ReadInputAsync()
    {
        try
        {
            while (!cancellation.IsCancellationRequested)
            {
                var line = await Console.In.ReadLineAsync(cancellation.Token).ConfigureAwait(false);
                if (line is null)
                {
                    break;
                }

                if (!HelperProtocol.TryParse(line, out var kind, out var incomingState))
                {
                    continue;
                }

                switch (kind)
                {
                    case InboundMessageKind.Update when incomingState is not null:
                        await dispatcher.InvokeAsync(
                            () => UpdateState(incomingState),
                            DispatcherPriority.Background,
                            cancellation.Token);
                        break;
                    case InboundMessageKind.Stop:
                        await dispatcher.InvokeAsync(
                            RequestShutdown,
                            DispatcherPriority.Send,
                            cancellation.Token);
                        return;
                }
            }
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (IOException exception)
        {
            Diagnostics.Write($"Input pipe failed: {exception.Message}");
        }
        finally
        {
            if (!cancellation.IsCancellationRequested)
            {
                _ = dispatcher.InvokeAsync(RequestShutdown, DispatcherPriority.Send);
            }
        }
    }

    private void UpdateState(LyricsState incomingState)
    {
        if (disposed)
        {
            return;
        }

        state = incomingState;
        if (string.IsNullOrWhiteSpace(state.TrackId))
        {
            widget?.Hide();
            return;
        }

        var currentWidget = EnsureWidget();
        currentWidget.UpdateState(state);
        RefreshHost();
    }

    private LyricsWidgetWindow EnsureWidget()
    {
        if (widget is not null)
        {
            var existingHandle = new WindowInteropHelper(widget).Handle;
            if (existingHandle != IntPtr.Zero && NativeMethods.IsWindow(existingHandle))
            {
                return widget;
            }
        }

        widget = new LyricsWidgetWindow
        {
            Left = -32_000,
            Top = -32_000,
        };
        widget.ActionRequested += HelperProtocol.WriteAction;
        widget.HostInvalidated += QueueRefresh;
        _ = widget.EnsureNativeHandle();
        attachedTaskbar = IntPtr.Zero;
        return widget;
    }

    private void RefreshHost()
    {
        if (disposed || state is null || string.IsNullOrWhiteSpace(state.TrackId))
        {
            return;
        }

        try
        {
            var currentWidget = EnsureWidget();
            currentWidget.UpdateState(state);
            if (!currentWidget.IsVisible)
            {
                currentWidget.Show();
            }

            var handle = currentWidget.EnsureNativeHandle();
            var taskbar = taskbarLocator.FindTaskbar(monitorPreference);
            if (taskbar is not { } target)
            {
                ShowOverlay(currentWidget, handle, null);
                return;
            }

            var dpiScale = NativeMethods.GetSafeDpi(target.Window) / 96D;
            var minimumTaskbarThickness = Math.Max(28, (int)Math.Round(28 * dpiScale));
            if (!target.IsHorizontal || target.Bounds.Height < minimumTaskbarThickness)
            {
                ShowOverlay(currentWidget, handle, target);
                return;
            }

            if (!TryAttach(currentWidget, handle, target.Window)
                || !PositionEmbedded(currentWidget, handle, target, dpiScale))
            {
                ShowOverlay(currentWidget, handle, target);
            }
        }
        catch (Exception exception)
        {
            Diagnostics.Write($"Host refresh failed: {exception.Message}");
            if (widget is not null)
            {
                var handle = new WindowInteropHelper(widget).Handle;
                if (handle != IntPtr.Zero && NativeMethods.IsWindow(handle))
                {
                    ShowOverlay(widget, handle, null);
                }
            }
        }
    }

    private bool TryAttach(
        LyricsWidgetWindow currentWidget,
        IntPtr handle,
        IntPtr taskbar)
    {
        if (NativeMethods.GetParent(handle) == taskbar)
        {
            attachedTaskbar = taskbar;
            lastAttachFailure = IntPtr.Zero;
            return true;
        }

        if (NativeMethods.GetParent(handle) != IntPtr.Zero)
        {
            _ = NativeMethods.SetParent(handle, IntPtr.Zero);
            currentWidget.PrepareForPopup(handle);
        }

        currentWidget.PrepareForChild(handle);
        NativeMethods.SetLastError(0);
        var previousParent = NativeMethods.SetParent(handle, taskbar);
        var error = Marshal.GetLastWin32Error();
        var attached = NativeMethods.GetParent(handle) == taskbar;
        if (!attached)
        {
            _ = NativeMethods.SetParent(handle, IntPtr.Zero);
            currentWidget.PrepareForPopup(handle);
            attachedTaskbar = IntPtr.Zero;
            if (lastAttachFailure != taskbar)
            {
                Diagnostics.Write(
                    $"SetParent failed for taskbar 0x{taskbar.ToInt64():X} "
                    + $"(previous=0x{previousParent.ToInt64():X}, error={error}); using overlay.");
                lastAttachFailure = taskbar;
            }
            return false;
        }

        attachedTaskbar = taskbar;
        lastAttachFailure = IntPtr.Zero;
        return true;
    }

    private bool PositionEmbedded(
        LyricsWidgetWindow currentWidget,
        IntPtr handle,
        TaskbarTarget target,
        double dpiScale)
    {
        var margin = Math.Max(3, (int)Math.Round(4 * dpiScale));
        var availableWidth = Math.Max(1, target.Bounds.Width - (margin * 2));
        var preferredWidth = (int)Math.Round(LyricsWidgetWindow.PreferredWidth * dpiScale);
        var minimumWidth = (int)Math.Round(160 * dpiScale);
        var proportionalWidth = (int)Math.Round(target.Bounds.Width * 0.42);
        var width = Math.Min(
            availableWidth,
            Math.Max(minimumWidth, Math.Min(preferredWidth, proportionalWidth)));
        var height = Math.Min(
            target.Bounds.Height - 2,
            (int)Math.Round(LyricsWidgetWindow.PreferredHeight * dpiScale));
        if (width <= 0 || height <= 0)
        {
            return false;
        }

        var trayAnchor = taskbarLocator.TryGetTrayAnchor(target, QueueRefresh);
        var rightBoundary = trayAnchor?.Left
            ?? target.Bounds.Right - (int)Math.Round(144 * dpiScale);
        var x = Math.Clamp(
            rightBoundary - width - margin,
            target.Bounds.Left + margin,
            target.Bounds.Right - width - margin);
        var y = target.Bounds.Top + ((target.Bounds.Height - height) / 2);
        var clientPoint = new NativePoint(x, y);
        if (!NativeMethods.ScreenToClient(target.Window, ref clientPoint))
        {
            return false;
        }

        currentWidget.SetLogicalSize(width / dpiScale, height / dpiScale);
        return NativeMethods.SetWindowPos(
            handle,
            NativeMethods.HwndTop,
            clientPoint.X,
            clientPoint.Y,
            width,
            height,
            NativeMethods.SwpNoActivate
                | NativeMethods.SwpShowWindow
                | NativeMethods.SwpFrameChanged);
    }

    private void ShowOverlay(
        LyricsWidgetWindow currentWidget,
        IntPtr handle,
        TaskbarTarget? taskbar)
    {
        DetachForOverlay(currentWidget, handle);

        var fallback = taskbar is { } target
            ? new MonitorTarget(target.Monitor, target.MonitorBounds, target.WorkArea)
            : taskbarLocator.GetFallbackMonitor(monitorPreference);
        var dpiScale = taskbar is { } taskbarTarget
            ? NativeMethods.GetSafeDpi(taskbarTarget.Window) / 96D
            : NativeMethods.GetSafeDpi(handle) / 96D;
        var width = Math.Min(
            Math.Max(1, fallback.Bounds.Width - 16),
            (int)Math.Round(LyricsWidgetWindow.PreferredWidth * dpiScale));
        var height = Math.Min(
            Math.Max(1, fallback.Bounds.Height - 16),
            (int)Math.Round(LyricsWidgetWindow.PreferredHeight * dpiScale));
        var x = fallback.WorkArea.Right - width - 8;
        var y = fallback.WorkArea.Bottom - height - 8;

        if (taskbar is { } positionedTaskbar)
        {
            if (positionedTaskbar.IsHorizontal)
            {
                var isBottom = positionedTaskbar.Bounds.Top
                    >= (positionedTaskbar.MonitorBounds.Top + positionedTaskbar.MonitorBounds.Bottom) / 2;
                y = isBottom
                    ? positionedTaskbar.Bounds.Top - height - 6
                    : positionedTaskbar.Bounds.Bottom + 6;
            }
            else
            {
                var isRight = positionedTaskbar.Bounds.Left
                    >= (positionedTaskbar.MonitorBounds.Left + positionedTaskbar.MonitorBounds.Right) / 2;
                x = isRight
                    ? positionedTaskbar.Bounds.Left - width - 6
                    : positionedTaskbar.Bounds.Right + 6;
            }
        }

        x = Math.Clamp(x, fallback.Bounds.Left + 4, fallback.Bounds.Right - width - 4);
        y = Math.Clamp(y, fallback.Bounds.Top + 4, fallback.Bounds.Bottom - height - 4);
        currentWidget.SetLogicalSize(width / dpiScale, height / dpiScale);
        _ = NativeMethods.SetWindowPos(
            handle,
            NativeMethods.HwndTopmost,
            x,
            y,
            width,
            height,
            NativeMethods.SwpNoActivate
                | NativeMethods.SwpShowWindow
                | NativeMethods.SwpFrameChanged);
    }

    private void DetachForOverlay(LyricsWidgetWindow currentWidget, IntPtr handle)
    {
        if (NativeMethods.GetParent(handle) != IntPtr.Zero)
        {
            _ = NativeMethods.SetParent(handle, IntPtr.Zero);
        }
        currentWidget.PrepareForPopup(handle);
        attachedTaskbar = IntPtr.Zero;
    }

    private IntPtr MessageWindowProcedure(
        IntPtr window,
        int message,
        IntPtr wordParameter,
        IntPtr longParameter,
        ref bool handled)
    {
        _ = window;
        _ = wordParameter;
        _ = longParameter;
        _ = handled;
        if ((taskbarCreatedMessage != 0 && (uint)message == taskbarCreatedMessage)
            || message is WmDisplayChange or WmSettingChange or WmDeviceChange)
        {
            attachedTaskbar = IntPtr.Zero;
            taskbarLocator.Invalidate();
            QueueRefresh();
        }

        return IntPtr.Zero;
    }

    private void QueueRefresh()
    {
        if (!disposed)
        {
            _ = dispatcher.InvokeAsync(RefreshHost, DispatcherPriority.Background);
        }
    }

    private void RequestShutdown()
    {
        if (!disposed)
        {
            cancellation.Cancel();
            application.Shutdown();
        }
    }
}
