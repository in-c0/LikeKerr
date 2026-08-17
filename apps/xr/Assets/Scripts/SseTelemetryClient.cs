using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace LikeKerr.XR
{
    public sealed class SseTelemetryClient : MonoBehaviour
    {
        [Tooltip("Read-only LikeKerr session event stream. For Quest/LAN use the host PC's LAN IP and demo:xr port 4174.")]
        public string endpoint = "http://127.0.0.1:4173/events";

        public bool reconnectOnTransportError = true;
        public float reconnectDelaySeconds = 1.5f;

        public event Action<SessionFrameTelemetry> FrameReceived;
        public event Action<SessionSummaryTelemetry> SummaryReceived;
        public event Action<string> StatusChanged;

        public string ConnectionStatus { get; private set; } = "Idle";

        private readonly ConcurrentQueue<string> incoming = new();
        private UnityWebRequest activeRequest;
        private Coroutine streamLoop;

        private void OnEnable()
        {
            streamLoop = StartCoroutine(StreamLoop());
        }

        private void Update()
        {
            DrainIncoming();
        }

        private void OnDisable()
        {
            if (streamLoop != null)
            {
                StopCoroutine(streamLoop);
                streamLoop = null;
            }

            activeRequest?.Abort();
            activeRequest?.Dispose();
            activeRequest = null;
            SetStatus("Disconnected");
        }

        private IEnumerator StreamLoop()
        {
            while (enabled)
            {
                using var request = new UnityWebRequest(endpoint, UnityWebRequest.kHttpVerbGET);
                request.SetRequestHeader("Accept", "text/event-stream");
                request.downloadHandler = new SseDownloadHandler(payload => incoming.Enqueue(payload));
                activeRequest = request;

                SetStatus("Connecting");
                var operation = request.SendWebRequest();
                SetStatus("Live");

                while (!operation.isDone)
                {
                    DrainIncoming();
                    yield return null;
                }

                DrainIncoming();
                activeRequest = null;

                if (request.result == UnityWebRequest.Result.Success)
                {
                    SetStatus("Session complete");
                    yield break;
                }

                SetStatus($"Transport error: {request.error}");
                if (!reconnectOnTransportError)
                {
                    yield break;
                }

                yield return new WaitForSecondsRealtime(Mathf.Max(0.1f, reconnectDelaySeconds));
            }
        }

        private void DrainIncoming()
        {
            while (incoming.TryDequeue(out var payload))
            {
                ParsePayload(payload);
            }
        }

        private void ParsePayload(string payload)
        {
            if (string.IsNullOrWhiteSpace(payload)) return;

            // JsonUtility does not represent nullable primitive fields. The LikeKerr
            // stream uses null before HR Sync / next effort are available, so the XR
            // presentation maps only those known nullable fields to -1 sentinels.
            var normalized = payload
                .Replace("\"hrSync\":null", "\"hrSync\":-1")
                .Replace("\"sessionSync\":null", "\"sessionSync\":-1")
                .Replace("\"nextEffort01\":null", "\"nextEffort01\":-1")
                .Replace("\"averageHrBpm\":null", "\"averageHrBpm\":-1");

            if (normalized.Contains("\"type\":\"frame\""))
            {
                var frame = JsonUtility.FromJson<SessionFrameTelemetry>(normalized);
                if (frame?.source != null && frame.treadmill != null)
                {
                    FrameReceived?.Invoke(frame);
                }
                return;
            }

            if (normalized.Contains("\"type\":\"summary\""))
            {
                var summary = JsonUtility.FromJson<SessionSummaryTelemetry>(normalized);
                if (summary != null)
                {
                    SummaryReceived?.Invoke(summary);
                }
            }
        }

        private void SetStatus(string status)
        {
            ConnectionStatus = status;
            StatusChanged?.Invoke(status);
        }

        private sealed class SseDownloadHandler : DownloadHandlerScript
        {
            private readonly Action<string> onPayload;
            private readonly StringBuilder buffer = new();

            public SseDownloadHandler(Action<string> onPayload)
                : base(new byte[16 * 1024])
            {
                this.onPayload = onPayload;
            }

            protected override bool ReceiveData(byte[] data, int dataLength)
            {
                if (data == null || dataLength <= 0) return true;

                buffer.Append(Encoding.UTF8.GetString(data, 0, dataLength).Replace("\r\n", "\n"));
                EmitCompleteEvents();
                return true;
            }

            private void EmitCompleteEvents()
            {
                while (true)
                {
                    var text = buffer.ToString();
                    var boundary = text.IndexOf("\n\n", StringComparison.Ordinal);
                    if (boundary < 0) return;

                    var block = text.Substring(0, boundary);
                    buffer.Remove(0, boundary + 2);

                    var payload = new StringBuilder();
                    foreach (var line in block.Split('\n'))
                    {
                        if (!line.StartsWith("data:", StringComparison.Ordinal)) continue;
                        if (payload.Length > 0) payload.Append('\n');
                        payload.Append(line.Substring(5).TrimStart());
                    }

                    if (payload.Length > 0)
                    {
                        onPayload(payload.ToString());
                    }
                }
            }
        }
    }
}
