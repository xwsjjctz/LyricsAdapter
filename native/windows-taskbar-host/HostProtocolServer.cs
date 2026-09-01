using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows.Threading;

namespace LyricsAdapter.TaskbarHost;

internal sealed class HostState
{
    public string ArtworkSource { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Artist { get; set; } = string.Empty;
    public string Line { get; set; } = string.Empty;
    public string NextLine { get; set; } = string.Empty;
    public int? LineCursor { get; set; }
    public int? LineProgress { get; set; }
    public bool IsPlaying { get; set; }
    public string PlacementMode { get; set; } = "auto";
    public double? ManualPosition { get; set; }
}

internal sealed class HostPlacement
{
    public string Mode { get; init; } = "auto";
    public double? Position { get; init; }
}

internal sealed class HostCommand
{
    public string Type { get; set; } = string.Empty;
    public HostState? State { get; set; }
    public bool? Visible { get; set; }
}

internal sealed class HostBounds
{
    public int X { get; init; }
    public int Y { get; init; }
    public int Width { get; init; }
    public int Height { get; init; }
}

internal sealed class HostStatus
{
    public bool Attached { get; init; }
    public bool? Topmost { get; init; }
    public string Reason { get; init; } = string.Empty;
    public string? Edge { get; init; }
    public uint? Dpi { get; init; }
    public HostBounds? BoundsPx { get; init; }
    public string? PlacementMode { get; init; }
    public double? ManualPosition { get; init; }
    public bool? PlacementAdjusted { get; init; }
    public int? OccupiedRegionCount { get; init; }
}

internal sealed class HostProtocolServer : IDisposable
{
    internal const int ApiVersion = 2;
    private const int MaxLineLength = 64 * 1024;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        MaxDepth = 8,
    };

    private readonly TaskbarLyricsWindow _window;
    private readonly Dispatcher _dispatcher;
    private readonly Action<int> _shutdown;
    private readonly StreamReader _input;
    private readonly StreamWriter _output;
    private readonly StreamWriter _error;
    private readonly object _writeLock = new();
    private bool _disposed;
    private bool _shutdownRequested;

    internal HostProtocolServer(
        TaskbarLyricsWindow window,
        Dispatcher dispatcher,
        Action<int> shutdown)
    {
        _window = window;
        _dispatcher = dispatcher;
        _shutdown = shutdown;

        // A WPF WinExe has no console, but Electron gives it inherited stdio
        // pipes. Read those streams directly so the protocol is always UTF-8,
        // independent of the user's active Windows code page.
        _input = new StreamReader(
            Console.OpenStandardInput(),
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true),
            detectEncodingFromByteOrderMarks: false,
            bufferSize: 4096,
            leaveOpen: true);
        _output = CreateUtf8Writer(Console.OpenStandardOutput());
        _error = CreateUtf8Writer(Console.OpenStandardError());
    }

    internal static bool HasCompatibleProtocolArgument(string[] args)
    {
        for (var index = 0; index < args.Length - 1; index++)
        {
            if (args[index] == "--protocol-version"
                && int.TryParse(args[index + 1], out var version))
            {
                return version == ApiVersion;
            }
        }
        return false;
    }

    internal async Task RunAsync()
    {
        try
        {
            while (!_disposed)
            {
                var line = await _input.ReadLineAsync().ConfigureAwait(false);
                if (line is null)
                {
                    RequestShutdown(0);
                    return;
                }
                if (line.Length == 0 || line.Length > MaxLineLength)
                {
                    _error.WriteLine("Ignored an invalid taskbar host command length.");
                    continue;
                }

                HostCommand? command;
                try
                {
                    command = JsonSerializer.Deserialize<HostCommand>(line, JsonOptions);
                }
                catch (JsonException error)
                {
                    _error.WriteLine($"Ignored malformed taskbar host JSON: {error.Message}");
                    continue;
                }

                if (command is null) continue;
                await _dispatcher.InvokeAsync(
                    () => HandleCommand(command),
                    DispatcherPriority.Send);
            }
        }
        catch (ObjectDisposedException) when (_disposed)
        {
            // Normal shutdown closes the inherited stdio handles.
        }
        catch (Exception error)
        {
            _error.WriteLine($"Taskbar host protocol failed: {error}");
            RequestShutdown(1);
        }
    }

    internal void WriteReady()
    {
        Write(new { type = "ready", apiVersion = ApiVersion });
    }

    internal void WriteAction(string action)
    {
        Write(new { type = "action", action });
    }

    internal void WritePlacement(HostPlacement placement)
    {
        Write(new
        {
            type = "placement",
            mode = placement.Mode,
            position = placement.Position,
        });
    }

    internal void WriteStatus(HostStatus status)
    {
        Write(new
        {
            type = "status",
            attached = status.Attached,
            topmost = status.Topmost,
            reason = status.Reason,
            edge = status.Edge,
            dpi = status.Dpi,
            boundsPx = status.BoundsPx,
            placementMode = status.PlacementMode,
            manualPosition = status.ManualPosition,
            placementAdjusted = status.PlacementAdjusted,
            occupiedRegionCount = status.OccupiedRegionCount,
        });
    }

    public void Dispose()
    {
        _disposed = true;
    }

    private void HandleCommand(HostCommand command)
    {
        if (_disposed) return;
        switch (command.Type)
        {
            case "update" when command.State is not null:
                _window.UpdateState(command.State);
                break;
            case "visibility" when command.Visible.HasValue:
                _window.SetRequestedVisible(command.Visible.Value);
                break;
            case "refresh":
                _window.RefreshAttachment();
                break;
            case "shutdown":
                RequestShutdown(0);
                break;
            default:
                _error.WriteLine($"Ignored unknown taskbar host command: {command.Type}");
                break;
        }
    }

    private void Write<T>(T message)
    {
        if (_disposed) return;
        var serialized = JsonSerializer.Serialize(message, JsonOptions);
        if (serialized.Length > MaxLineLength) return;
        lock (_writeLock)
        {
            _output.WriteLine(serialized);
        }
    }

    private void RequestShutdown(int exitCode)
    {
        if (_shutdownRequested || _disposed) return;
        _shutdownRequested = true;
        _dispatcher.BeginInvoke(
            () => _shutdown(exitCode),
            DispatcherPriority.Send);
    }

    private static StreamWriter CreateUtf8Writer(Stream stream)
    {
        return new StreamWriter(
            stream,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
            bufferSize: 4096,
            leaveOpen: true)
        {
            AutoFlush = true,
            NewLine = "\n",
        };
    }
}
