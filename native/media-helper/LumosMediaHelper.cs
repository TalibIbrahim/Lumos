// Lumos system media helper.
//
// A small console process that reports, as JSON lines on stdout:
//   {"t":"media",...}  the current media session: playback status, an opaque
//                      track key, and a 48x48 RGBA thumbnail when the track changes
//   {"t":"sys",...}    the system output peak level and whether a full-screen
//                      app or presentation is active
//
// Track titles and artists never leave this process; only a hash is reported.
// The helper exits when its stdin closes, so it never outlives the app.
//
// Built with the C# compiler that ships with the .NET Framework on Windows
// (see scripts/build-media-helper.js).

using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using Windows.Foundation;
using Windows.Graphics.Imaging;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace Lumos
{
    internal static class Native
    {
        [DllImport("shell32.dll")]
        private static extern int SHQueryUserNotificationState(out int state);

        // 2 = busy (full-screen app), 3 = running a Direct3D full-screen app, 4 = presentation mode
        public static bool IsFullScreenActive()
        {
            int state;
            if (SHQueryUserNotificationState(out state) != 0) return false;
            return state == 2 || state == 3 || state == 4;
        }

        [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
        private class MMDeviceEnumeratorCom { }

        [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDeviceEnumerator
        {
            int NotImpl1();
            [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
        }

        [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDevice
        {
            [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        }

        [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IAudioMeterInformation
        {
            [PreserveSig] int GetPeakValue(out float peak);
        }

        private static IAudioMeterInformation meter;
        private static DateTime meterAcquired = DateTime.MinValue;

        // Peak of the default output device, 0..1, or -1 when unavailable.
        public static float OutputPeak()
        {
            try
            {
                // Re-acquire periodically so a change of default device is picked up.
                if (meter == null || (DateTime.UtcNow - meterAcquired).TotalSeconds > 30)
                {
                    meter = null;
                    IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
                    IMMDevice dev;
                    if (en.GetDefaultAudioEndpoint(0, 1, out dev) != 0) return -1;
                    Guid iid = typeof(IAudioMeterInformation).GUID;
                    object o;
                    if (dev.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) return -1;
                    meter = (IAudioMeterInformation)o;
                    meterAcquired = DateTime.UtcNow;
                }
                float p;
                if (meter.GetPeakValue(out p) != 0) { meter = null; return -1; }
                return p;
            }
            catch
            {
                meter = null;
                return -1;
            }
        }
    }

    internal static class Async
    {
        // Waits for a WinRT operation without the SDK-only AsTask projection.
        public static T Wait<T>(IAsyncOperation<T> op, int timeoutMs)
        {
            using (ManualResetEvent done = new ManualResetEvent(false))
            {
                op.Completed = delegate { done.Set(); };
                if (!done.WaitOne(timeoutMs))
                {
                    op.Cancel();
                    throw new TimeoutException();
                }
                if (op.Status != AsyncStatus.Completed) throw new InvalidOperationException(op.Status.ToString());
                return op.GetResults();
            }
        }
    }

    internal static class Program
    {
        private static readonly object OutLock = new object();
        private static volatile bool running = true;

        private static void Emit(string json)
        {
            lock (OutLock)
            {
                Console.Out.Write(json);
                Console.Out.Write('\n');
                Console.Out.Flush();
            }
        }

        private static string Esc(string s)
        {
            if (s == null) return "";
            StringBuilder sb = new StringBuilder(s.Length + 8);
            foreach (char c in s)
            {
                if (c == '"' || c == '\\') { sb.Append('\\'); sb.Append(c); }
                else if (c < 0x20) sb.AppendFormat("\\u{0:x4}", (int)c);
                else sb.Append(c);
            }
            return sb.ToString();
        }

        private static string Hash(string s)
        {
            using (SHA1 sha = SHA1.Create())
            {
                byte[] b = sha.ComputeHash(Encoding.UTF8.GetBytes(s));
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < 8; i++) sb.Append(b[i].ToString("x2"));
                return sb.ToString();
            }
        }

        private static int Main(string[] args)
        {
            int intervalMs = 1000;
            bool mediaEnabled = true;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--interval" && i + 1 < args.Length) int.TryParse(args[i + 1], out intervalMs);
                if (args[i] == "--no-media") mediaEnabled = false;
            }
            if (intervalMs < 250) intervalMs = 250;
            if (intervalMs > 10000) intervalMs = 10000;

            Console.OutputEncoding = new UTF8Encoding(false);

            // Exit when the parent closes our stdin.
            Thread stdinWatcher = new Thread(delegate ()
            {
                try { while (Console.In.Read() >= 0) { } } catch { }
                running = false;
            });
            stdinWatcher.IsBackground = true;
            stdinWatcher.Start();

            Emit("{\"t\":\"ready\",\"v\":1}");

            GlobalSystemMediaTransportControlsSessionManager manager = null;
            string lastStatus = null;
            string lastKey = null;
            int ticks = 0;

            while (running)
            {
                // Sample the output level several times per interval and report the maximum.
                float peak = -1;
                int samples = Math.Max(1, intervalMs / 100);
                for (int i = 0; i < samples && running; i++)
                {
                    float p = Native.OutputPeak();
                    if (p > peak) peak = p;
                    Thread.Sleep(intervalMs / samples);
                }
                if (!running) break;

                bool full = Native.IsFullScreenActive();
                Emit(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                    "{{\"t\":\"sys\",\"peak\":{0:0.0000},\"fullscreen\":{1}}}", peak, full ? "true" : "false"));

                if (!mediaEnabled) continue;
                try
                {
                    if (manager == null)
                    {
                        manager = Async.Wait(GlobalSystemMediaTransportControlsSessionManager.RequestAsync(), 5000);
                    }
                    GlobalSystemMediaTransportControlsSession session = PickSession(manager);
                    if (session == null)
                    {
                        if (lastStatus != "None" || ticks % 5 == 0)
                        {
                            Emit("{\"t\":\"media\",\"status\":\"None\"}");
                        }
                        lastStatus = "None";
                        lastKey = null;
                    }
                    else
                    {
                        string status = session.GetPlaybackInfo().PlaybackStatus.ToString();
                        GlobalSystemMediaTransportControlsSessionMediaProperties props =
                            Async.Wait(session.TryGetMediaPropertiesAsync(), 3000);
                        string key = props == null ? "" : Hash(
                            (props.Title ?? "") + "\u0001" + (props.Artist ?? "") + "\u0001" + (props.AlbumTitle ?? "") +
                            "\u0001" + (session.SourceAppUserModelId ?? ""));

                        bool trackChanged = key != lastKey;
                        string thumb = null;
                        if (trackChanged && props != null && props.Thumbnail != null)
                        {
                            thumb = ReadThumbnail(props);
                        }
                        if (trackChanged || status != lastStatus || ticks % 5 == 0)
                        {
                            Emit("{\"t\":\"media\",\"status\":\"" + Esc(status) + "\",\"app\":\"" +
                                 Esc(session.SourceAppUserModelId) + "\",\"key\":\"" + key + "\"" +
                                 (thumb != null ? ",\"thumb\":\"" + thumb + "\",\"w\":48,\"h\":48" : "") + "}");
                        }
                        lastStatus = status;
                        // Only remember the key once a thumbnail was attempted, so a late thumbnail is retried.
                        if (thumb != null || props == null || props.Thumbnail == null || !trackChanged) lastKey = key;
                    }
                }
                catch (Exception ex)
                {
                    manager = null;
                    Emit("{\"t\":\"error\",\"message\":\"" + Esc(ex.GetType().Name) + "\"}");
                }
                ticks++;
            }
            return 0;
        }

        private static GlobalSystemMediaTransportControlsSession PickSession(GlobalSystemMediaTransportControlsSessionManager manager)
        {
            // Prefer a session that is actually playing over the system's notion of "current".
            IReadOnlyList<GlobalSystemMediaTransportControlsSession> sessions = manager.GetSessions();
            foreach (GlobalSystemMediaTransportControlsSession s in sessions)
            {
                try
                {
                    if (s.GetPlaybackInfo().PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing) return s;
                }
                catch { }
            }
            return manager.GetCurrentSession();
        }

        private static string ReadThumbnail(GlobalSystemMediaTransportControlsSessionMediaProperties props)
        {
            try
            {
                IRandomAccessStreamWithContentType stream = Async.Wait(props.Thumbnail.OpenReadAsync(), 3000);
                using (stream)
                {
                    BitmapDecoder decoder = Async.Wait(BitmapDecoder.CreateAsync(stream), 3000);
                    BitmapTransform transform = new BitmapTransform();
                    transform.ScaledWidth = 48;
                    transform.ScaledHeight = 48;
                    transform.InterpolationMode = BitmapInterpolationMode.Linear;
                    PixelDataProvider pixels = Async.Wait(decoder.GetPixelDataAsync(
                        BitmapPixelFormat.Rgba8, BitmapAlphaMode.Ignore, transform,
                        ExifOrientationMode.RespectExifOrientation, ColorManagementMode.DoNotColorManage), 3000);
                    return Convert.ToBase64String(pixels.DetachPixelData());
                }
            }
            catch
            {
                return null;
            }
        }
    }
}
