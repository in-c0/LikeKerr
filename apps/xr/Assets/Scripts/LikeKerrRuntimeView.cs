using System.Text;
using UnityEngine;

namespace LikeKerr.XR
{
    public sealed class LikeKerrRuntimeView : MonoBehaviour
    {
        public SseTelemetryClient telemetryClient;

        private GameObject pitch;
        private GameObject playerGhost;
        private TextMesh hud;
        private SessionFrameTelemetry latestFrame;
        private SessionSummaryTelemetry latestSummary;
        private string connectionStatus = "Idle";

        private const float PitchLengthWorld = 10.5f;
        private const float PitchWidthWorld = 6.8f;
        private const float PitchCenterZ = 4.2f;

        private void Start()
        {
            if (telemetryClient == null)
            {
                telemetryClient = GetComponent<SseTelemetryClient>();
            }

            BuildWorld();

            if (telemetryClient != null)
            {
                telemetryClient.FrameReceived += OnFrame;
                telemetryClient.SummaryReceived += OnSummary;
                telemetryClient.StatusChanged += OnStatus;
                connectionStatus = telemetryClient.ConnectionStatus;
            }

            RefreshHud();
        }

        private void OnDestroy()
        {
            if (telemetryClient == null) return;
            telemetryClient.FrameReceived -= OnFrame;
            telemetryClient.SummaryReceived -= OnSummary;
            telemetryClient.StatusChanged -= OnStatus;
        }

        private void BuildWorld()
        {
            pitch = GameObject.CreatePrimitive(PrimitiveType.Plane);
            pitch.name = "Tracked Match Pitch";
            pitch.transform.SetParent(transform, false);
            pitch.transform.position = new Vector3(0f, 0f, PitchCenterZ);
            // Unity's primitive Plane is 10 x 10 units.
            pitch.transform.localScale = new Vector3(PitchLengthWorld / 10f, 1f, PitchWidthWorld / 10f);
            SetRendererColor(pitch, new Color(0.07f, 0.23f, 0.13f));

            CreatePitchLine(new Vector3(0f, 0.012f, PitchCenterZ), new Vector3(0.025f, 0.02f, PitchWidthWorld));
            CreatePitchLine(new Vector3(0f, 0.012f, PitchCenterZ - PitchWidthWorld / 2f), new Vector3(PitchLengthWorld, 0.02f, 0.025f));
            CreatePitchLine(new Vector3(0f, 0.012f, PitchCenterZ + PitchWidthWorld / 2f), new Vector3(PitchLengthWorld, 0.02f, 0.025f));
            CreatePitchLine(new Vector3(-PitchLengthWorld / 2f, 0.012f, PitchCenterZ), new Vector3(0.025f, 0.02f, PitchWidthWorld));
            CreatePitchLine(new Vector3(PitchLengthWorld / 2f, 0.012f, PitchCenterZ), new Vector3(0.025f, 0.02f, PitchWidthWorld));

            playerGhost = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            playerGhost.name = "Tracked Player Ghost";
            playerGhost.transform.SetParent(transform, false);
            playerGhost.transform.localScale = Vector3.one * 0.22f;
            playerGhost.transform.position = new Vector3(0f, 0.16f, PitchCenterZ);
            SetRendererColor(playerGhost, Color.white);

            var camera = Camera.main;
            if (camera != null)
            {
                var hudObject = new GameObject("LikeKerr HUD");
                hudObject.transform.SetParent(camera.transform, false);
                hudObject.transform.localPosition = new Vector3(-0.75f, 0.5f, 2.0f);
                hudObject.transform.localRotation = Quaternion.identity;

                hud = hudObject.AddComponent<TextMesh>();
                hud.anchor = TextAnchor.UpperLeft;
                hud.alignment = TextAlignment.Left;
                hud.fontSize = 64;
                hud.characterSize = 0.012f;
                hud.color = Color.white;
                hud.text = "LikeKerr\nConnecting…";
            }
        }

        private void CreatePitchLine(Vector3 position, Vector3 scale)
        {
            var line = GameObject.CreatePrimitive(PrimitiveType.Cube);
            line.name = "Pitch Line";
            line.transform.SetParent(transform, false);
            line.transform.position = position;
            line.transform.localScale = scale;
            SetRendererColor(line, new Color(1f, 1f, 1f, 0.8f));
        }

        private static void SetRendererColor(GameObject target, Color color)
        {
            var renderer = target.GetComponent<Renderer>();
            if (renderer == null) return;

            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            if (shader == null) return;

            var material = new Material(shader) { color = color };
            renderer.material = material;
        }

        private void OnFrame(SessionFrameTelemetry frame)
        {
            latestFrame = frame;
            latestSummary = null;

            var normalizedX = Mathf.Clamp01(frame.source.xM / 105f);
            var normalizedY = Mathf.Clamp01(frame.source.yM / 68f);
            var worldX = (normalizedX - 0.5f) * PitchLengthWorld;
            var worldZ = PitchCenterZ + (normalizedY - 0.5f) * PitchWidthWorld;
            playerGhost.transform.position = new Vector3(worldX, 0.16f, worldZ);

            RefreshHud();
        }

        private void OnSummary(SessionSummaryTelemetry summary)
        {
            latestSummary = summary;
            RefreshHud();
        }

        private void OnStatus(string status)
        {
            connectionStatus = status;
            RefreshHud();
        }

        private void RefreshHud()
        {
            if (hud == null) return;

            var text = new StringBuilder();
            text.AppendLine("LIKEKERR · RUN THE MATCH");
            text.AppendLine($"XR stream: {connectionStatus}");
            text.AppendLine("Player tracking: measured · HR/treadmill: simulated");
            text.AppendLine();

            if (latestFrame != null)
            {
                text.AppendLine($"HR Sync      {FormatPercent(latestFrame.hrSync)}");
                text.AppendLine($"Target HR    {latestFrame.targetHrBpm:0} bpm");
                text.AppendLine($"Your HR      {latestFrame.actualHrBpm:0} bpm");
                text.AppendLine($"Player effort {latestFrame.source.effort01 * 100f:0}%");
                text.AppendLine($"Player speed  {latestFrame.source.speedMps:0.00} m/s");
                text.AppendLine($"Treadmill     {latestFrame.treadmill.speedKph:0.0} km/h");
                text.AppendLine($"Distance      {latestFrame.distanceKm:0.000} km");
                text.AppendLine(latestFrame.nextEffort01 >= 0f
                    ? $"Next effort   {latestFrame.nextEffort01 * 100f:0}%"
                    : "Next effort   final tracked frame");

                if (latestFrame.safety?.reasons != null && latestFrame.safety.reasons.Length > 0)
                {
                    text.AppendLine($"Safety        {string.Join(", ", latestFrame.safety.reasons)}");
                }
                else
                {
                    text.AppendLine("Safety        within envelope");
                }
            }
            else if (latestSummary != null)
            {
                text.AppendLine("SESSION COMPLETE");
                text.AppendLine($"Session Sync  {FormatPercent(latestSummary.hrSync)}");
                text.AppendLine($"Distance      {latestSummary.distanceKm:0.000} km");
                text.AppendLine($"Average HR    {latestSummary.averageHrBpm:0} bpm");
                text.AppendLine($"Max HR        {latestSummary.maxHrBpm:0} bpm");
                text.AppendLine($"Max speed     {latestSummary.maxSpeedKph:0.0} km/h");
            }
            else
            {
                text.AppendLine("Waiting for session telemetry…");
            }

            hud.text = text.ToString();
        }

        private static string FormatPercent(float value)
        {
            return value < 0f ? "—" : $"{value:0}%";
        }
    }
}
