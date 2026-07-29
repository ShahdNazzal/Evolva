import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type CallType = "audio" | "video";
type CallState = "idle" | "calling" | "ringing" | "in-call";

interface IncomingCall {
  type: CallType;
  offer: RTCSessionDescriptionInit;
}

// STUN عام بس، بدون TURN — يشتغل بمعظم الشبكات، بس ممكن يفشل ع شبكات موبايل
// بعض الأحيان بسبب NAT قاسي. لو صار في مشاكل اتصال دايمة لاحقًا منقدر نضيف TURN server.
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export function useCall(userId: string, otherId: string) {
  const [callState, setCallState] = useState<CallState>("idle");
  const [callType, setCallType] = useState<CallType>("audio");
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [duration, setDuration] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const durationTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callStateRef = useRef<CallState>("idle");

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  // اسم قناة ثابت بين نفس الشخصين، مرتّب أبجدياً عشان يطلع نفس الاسم عند الطرفين
  const channelName = `call:${[userId, otherId].sort().join(":")}`;

  const cleanup = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setIncoming(null);
    setCallState("idle");
    setDuration(0);
    pendingCandidates.current = [];
    if (durationTimer.current) clearInterval(durationTimer.current);
  }, []);

  const send = useCallback((event: string, payload: any) => {
    channelRef.current?.send({ type: "broadcast", event, payload });
  }, []);

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pc.onicecandidate = (e) => {
      if (e.candidate) send("ice-candidate", { candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      setRemoteStream(e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        send("call-end", {});
        cleanup();
      }
    };
    pcRef.current = pc;
    return pc;
  }, [send, cleanup]);

  useEffect(() => {
    const channel = supabase.channel(channelName);
    channelRef.current = channel;

    channel
      .on("broadcast", { event: "call-offer" }, ({ payload }) => {
        if (callStateRef.current !== "idle") return; // مشغولة بمكالمة تانية
        setIncoming({ type: payload.callType, offer: payload.sdp });
        setCallType(payload.callType);
        setCallState("ringing");
      })
      .on("broadcast", { event: "call-answer" }, async ({ payload }) => {
        if (!pcRef.current) return;
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        for (const c of pendingCandidates.current) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(c));
        }
        pendingCandidates.current = [];
        setCallState("in-call");
      })
      .on("broadcast", { event: "ice-candidate" }, async ({ payload }) => {
        if (pcRef.current?.remoteDescription) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } else {
          pendingCandidates.current.push(payload.candidate);
        }
      })
      .on("broadcast", { event: "call-reject" }, () => cleanup())
      .on("broadcast", { event: "call-end" }, () => cleanup())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName]);

  useEffect(() => {
    if (callState === "in-call") {
      durationTimer.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } else if (durationTimer.current) {
      clearInterval(durationTimer.current);
    }
    return () => {
      if (durationTimer.current) clearInterval(durationTimer.current);
    };
  }, [callState]);

  const startCall = useCallback(
    async (type: CallType) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === "video",
        });
        localStreamRef.current = stream;
        setLocalStream(stream);
        setCallType(type);
        setCallState("calling");
        const pc = createPeerConnection();
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send("call-offer", { sdp: offer, callType: type });
      } catch (err) {
        console.error("startCall error:", err);
        cleanup();
      }
    },
    [createPeerConnection, send, cleanup]
  );

  const acceptCall = useCallback(async () => {
    if (!incoming) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: incoming.type === "video",
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      const pc = createPeerConnection();
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      await pc.setRemoteDescription(new RTCSessionDescription(incoming.offer));
      for (const c of pendingCandidates.current) {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      }
      pendingCandidates.current = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send("call-answer", { sdp: answer });
      setIncoming(null);
      setCallState("in-call");
    } catch (err) {
      console.error("acceptCall error:", err);
      cleanup();
    }
  }, [incoming, createPeerConnection, send, cleanup]);

  const rejectCall = useCallback(() => {
    send("call-reject", {});
    cleanup();
  }, [send, cleanup]);

  const endCall = useCallback(() => {
    send("call-end", {});
    cleanup();
  }, [send, cleanup]);

  const toggleMute = useCallback((muted: boolean) => {
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }, []);

  const toggleCamera = useCallback((off: boolean) => {
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = !off));
  }, []);

  return {
    callState,
    callType,
    incoming,
    localStream,
    remoteStream,
    duration,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleCamera,
  };
}