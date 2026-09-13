using System.Windows;
using System.Windows.Threading;

namespace LyricsAdapter.TaskbarHost;

public partial class App : Application
{
    private HostProtocolServer? _protocol;
    private TaskbarLyricsWindow? _window;
    private bool _shutdownStarted;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        DispatcherUnhandledException += OnDispatcherUnhandledException;

        if (!HostProtocolServer.HasCompatibleProtocolArgument(e.Args))
        {
            Console.Error.WriteLine("Unsupported or missing host protocol version.");
            Shutdown(2);
            return;
        }

        _window = new TaskbarLyricsWindow();
        _protocol = new HostProtocolServer(_window, Dispatcher, ShutdownHost);
        _window.ActionRequested += action => _protocol.WriteAction(action);
        _window.PlacementChanged += placement => _protocol.WritePlacement(placement);
        _window.StatusChanged += status => _protocol.WriteStatus(status);
        _window.HostInvalidated += reason =>
        {
            if (_shutdownStarted) return;
            Console.Error.WriteLine($"Taskbar host window was invalidated: {reason}");
            ShutdownHost(1);
        };

        // Materialize the HWND off-screen without activating it. The first
        // update reparents and reveals it atomically inside Explorer's taskbar.
        _window.Show();
        _window.SetRequestedVisible(false);
        _protocol.WriteReady();
        _ = _protocol.RunAsync();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _protocol?.Dispose();
        _window?.Dispose();
        base.OnExit(e);
    }

    private void ShutdownHost(int exitCode)
    {
        if (_shutdownStarted) return;
        _shutdownStarted = true;
        _window?.SetRequestedVisible(false);
        Shutdown(exitCode);
    }

    private void OnDispatcherUnhandledException(
        object sender,
        DispatcherUnhandledExceptionEventArgs e)
    {
        Console.Error.WriteLine($"Unhandled taskbar host error: {e.Exception}");
        e.Handled = true;
        ShutdownHost(1);
    }
}
