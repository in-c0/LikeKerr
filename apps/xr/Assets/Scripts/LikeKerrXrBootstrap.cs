using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.XR;

namespace LikeKerr.XR
{
    public static class LikeKerrXrBootstrap
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void Bootstrap()
        {
            if (Object.FindFirstObjectByType<LikeKerrRuntimeView>() != null) return;

            EnsureTrackedCamera();

            var root = new GameObject("LikeKerr XR Runtime");
            Object.DontDestroyOnLoad(root);

            var client = root.AddComponent<SseTelemetryClient>();
            client.endpoint = ResolveEndpoint();

            var view = root.AddComponent<LikeKerrRuntimeView>();
            view.telemetryClient = client;
        }

        private static void EnsureTrackedCamera()
        {
            if (Camera.main != null) return;

            var rig = new GameObject("XR Camera Rig");
            Object.DontDestroyOnLoad(rig);

            var cameraObject = new GameObject("Main Camera");
            cameraObject.tag = "MainCamera";
            cameraObject.transform.SetParent(rig.transform, false);
            cameraObject.transform.localPosition = new Vector3(0f, 1.65f, 0f);

            var camera = cameraObject.AddComponent<Camera>();
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = 100f;
            camera.stereoTargetEye = StereoTargetEyeMask.Both;
            cameraObject.AddComponent<AudioListener>();

            var poseDriver = cameraObject.AddComponent<TrackedPoseDriver>();
            poseDriver.trackingType = TrackedPoseDriver.TrackingType.RotationAndPosition;
            poseDriver.updateType = TrackedPoseDriver.UpdateType.UpdateAndBeforeRender;

            var positionAction = new InputAction(
                "HMD Position",
                InputActionType.Value,
                "<XRHMD>/centerEyePosition",
                expectedControlType: "Vector3");
            var rotationAction = new InputAction(
                "HMD Rotation",
                InputActionType.Value,
                "<XRHMD>/centerEyeRotation",
                expectedControlType: "Quaternion");

            poseDriver.positionInput = new InputActionProperty(positionAction);
            poseDriver.rotationInput = new InputActionProperty(rotationAction);
            positionAction.Enable();
            rotationAction.Enable();
        }

        private static string ResolveEndpoint()
        {
            var environmentEndpoint = System.Environment.GetEnvironmentVariable("LIKEKERR_ENDPOINT");
            if (!string.IsNullOrWhiteSpace(environmentEndpoint))
            {
                return environmentEndpoint;
            }

            var args = System.Environment.GetCommandLineArgs();
            for (var i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == "-likekerrEndpoint" && !string.IsNullOrWhiteSpace(args[i + 1]))
                {
                    return args[i + 1];
                }
            }

            // Desktop editor / PC VR default. Standalone XR should explicitly use
            // the trusted-LAN demo:xr endpoint rather than relying on discovery.
            return "http://127.0.0.1:4173/events";
        }
    }
}
