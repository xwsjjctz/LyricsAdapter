using System.Windows;

namespace LyricsAdapter.TaskbarLyrics;

internal static class Program
{
    [STAThread]
    private static int Main(string[] arguments)
    {
        Diagnostics.ConfigureEncoding();
        var application = new Application
        {
            ShutdownMode = ShutdownMode.OnExplicitShutdown,
        };
        application.DispatcherUnhandledException += (_, eventArguments) =>
        {
            Diagnostics.Write($"Unhandled UI error: {eventArguments.Exception}");
            eventArguments.Handled = true;
            application.Shutdown(1);
        };

        using var controller = new TaskbarLyricsController(
            application,
            application.Dispatcher,
            MonitorPreference.Parse(arguments));
        controller.Start();
        return application.Run();
    }
}
