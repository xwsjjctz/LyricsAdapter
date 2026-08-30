using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Security;

namespace LyricsAdapter.TaskbarLyrics;

internal sealed class LyricsState
{
    [JsonPropertyName("trackId")]
    public string? TrackId { get; init; }

    [JsonPropertyName("title")]
    public string Title { get; init; } = string.Empty;

    [JsonPropertyName("artist")]
    public string Artist { get; init; } = string.Empty;

    [JsonPropertyName("line")]
    public string Line { get; init; } = string.Empty;

    [JsonPropertyName("nextLine")]
    public string NextLine { get; init; } = string.Empty;

    [JsonPropertyName("isPlaying")]
    public bool IsPlaying { get; init; }
}

internal enum InboundMessageKind
{
    None,
    Update,
    Stop,
}

internal static class HelperProtocol
{
    private const int MaximumMessageLength = 256 * 1024;
    private static readonly object OutputLock = new();
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    internal static bool TryParse(
        string line,
        out InboundMessageKind kind,
        out LyricsState? state)
    {
        kind = InboundMessageKind.None;
        state = null;
        if (string.IsNullOrWhiteSpace(line) || line.Length > MaximumMessageLength)
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(line);
            if (!document.RootElement.TryGetProperty("type", out var typeElement))
            {
                return false;
            }

            switch (typeElement.GetString())
            {
                case "stop":
                    kind = InboundMessageKind.Stop;
                    return true;
                case "update" when document.RootElement.TryGetProperty("state", out var stateElement):
                    state = stateElement.Deserialize<LyricsState>(SerializerOptions);
                    if (state is null)
                    {
                        return false;
                    }

                    kind = InboundMessageKind.Update;
                    return true;
                default:
                    return false;
            }
        }
        catch (JsonException exception)
        {
            Diagnostics.Write($"Ignoring malformed input: {exception.Message}");
            return false;
        }
    }

    internal static void WriteAction(string action)
    {
        try
        {
            var line = JsonSerializer.Serialize(new { type = "action", action });
            lock (OutputLock)
            {
                Console.Out.WriteLine(line);
                Console.Out.Flush();
            }
        }
        catch (IOException)
        {
            // The Electron parent has closed its pipe; stdin EOF will stop us.
        }
    }
}

internal static class Diagnostics
{
    internal static void Write(string message)
    {
        try
        {
            Console.Error.WriteLine($"[TaskbarLyrics] {message}");
            Console.Error.Flush();
        }
        catch (IOException)
        {
            // Diagnostics are optional when the parent has already exited.
        }
    }

    internal static void ConfigureEncoding()
    {
        var utf8 = new UTF8Encoding(false);
        try
        {
            Console.SetIn(new StreamReader(
                Console.OpenStandardInput(),
                utf8,
                detectEncodingFromByteOrderMarks: false,
                bufferSize: 4_096,
                leaveOpen: true));
        }
        catch (Exception exception) when (IsUnavailableConsole(exception))
        {
            // A WinExe opened without inherited standard handles uses the
            // framework's null reader instead of failing before WPF starts.
        }

        try
        {
            Console.SetOut(CreateUtf8Writer(Console.OpenStandardOutput(), utf8));
        }
        catch (Exception exception) when (IsUnavailableConsole(exception))
        {
            // Protocol output is unavailable; stdin EOF will shut us down.
        }

        try
        {
            Console.SetError(CreateUtf8Writer(Console.OpenStandardError(), utf8));
        }
        catch (Exception exception) when (IsUnavailableConsole(exception))
        {
            // Diagnostics are optional.
        }
    }

    private static StreamWriter CreateUtf8Writer(Stream stream, Encoding encoding)
    {
        return new StreamWriter(stream, encoding, 1_024, leaveOpen: true)
        {
            AutoFlush = true,
        };
    }

    private static bool IsUnavailableConsole(Exception exception)
    {
        return exception is IOException or SecurityException or UnauthorizedAccessException;
    }
}
