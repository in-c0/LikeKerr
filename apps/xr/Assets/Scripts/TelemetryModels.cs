using System;

namespace LikeKerr.XR
{
    [Serializable]
    public sealed class SessionSourceTelemetry
    {
        public int frame;
        public int sourceTMs;
        public float xM;
        public float yM;
        public float speedMps;
        public float effort01;
    }

    [Serializable]
    public sealed class SessionTreadmillTelemetry
    {
        public float speedKph;
        public float inclinePct;
        public bool simulated;
    }

    [Serializable]
    public sealed class SessionSafetyTelemetry
    {
        public bool limited;
        public string[] reasons;
    }

    [Serializable]
    public sealed class SessionFrameTelemetry
    {
        public string type;
        public int demoTMs;
        public SessionSourceTelemetry source;
        public float targetHrBpm;
        public float actualHrBpm;
        public float hrSync = -1f;
        public float sessionSync = -1f;
        public SessionTreadmillTelemetry treadmill;
        public float distanceKm;
        public float nextEffort01 = -1f;
        public SessionSafetyTelemetry safety;
    }

    [Serializable]
    public sealed class SessionSummaryTelemetry
    {
        public string type;
        public int elapsedSec;
        public float distanceKm;
        public float averageHrBpm;
        public float maxHrBpm;
        public float maxSpeedKph;
        public float hrSync = -1f;
        public int sourceFrames;
        public string telemetryPath;
    }
}
