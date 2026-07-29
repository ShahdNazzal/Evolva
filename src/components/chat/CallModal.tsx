import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, PhoneOff, Video, VideoOff, Mic, MicOff } from "lucide-react";

interface CallModalProps {
  call: any; // القيمة الراجعة من useCall
  otherName: string;
}

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function CallModal({ call, otherName }: CallModalProps) {
  const {
    callState,
    callType,
    incoming,
    localStream,
    remoteStream,
    duration,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleCamera,
  } = call;

  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (callType === "video" && remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
    if (callType === "audio" && remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, callType]);

  useEffect(() => {
    if (callState === "idle") {
      setMuted(false);
      setCameraOff(false);
    }
  }, [callState]);

  if (callState === "idle") return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex flex-col items-center justify-between text-white py-10 px-6"
      >
        <div className="absolute inset-0 overflow-hidden">
          {callType === "video" && remoteStream ? (
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full gradient-primary opacity-30" />
          )}
        </div>

        {callType === "audio" && <audio ref={remoteAudioRef} autoPlay />}

        <div className="relative z-10 flex flex-col items-center gap-2 mt-6">
          <motion.div
            animate={callState === "ringing" || callState === "calling" ? { scale: [1, 1.06, 1] } : {}}
            transition={{ repeat: Infinity, duration: 1.2 }}
            className="w-24 h-24 rounded-3xl gradient-primary flex items-center justify-center text-3xl font-extrabold shadow-soft"
          >
            {otherName?.[0] ?? "؟"}
          </motion.div>
          <div className="text-xl font-extrabold mt-2">{otherName}</div>
          <div className="text-sm text-white/70">
            {callState === "calling" && "جارِ الاتصال..."}
            {callState === "ringing" && incoming && "مكالمة واردة..."}
            {callState === "in-call" && formatDuration(duration)}
          </div>
        </div>

        {callType === "video" && localStream && (
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="absolute bottom-32 left-4 w-28 h-40 object-cover rounded-2xl border-2 border-white/40 shadow-soft z-10"
          />
        )}

        <div className="relative z-10 flex items-center gap-5">
          {callState === "ringing" && incoming ? (
            <>
              <button
                onClick={rejectCall}
                className="w-16 h-16 rounded-full bg-destructive flex items-center justify-center shadow-soft active:scale-95 transition"
              >
                <PhoneOff className="w-7 h-7" />
              </button>
              <button
                onClick={acceptCall}
                className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center shadow-soft active:scale-95 transition"
              >
                <Phone className="w-7 h-7" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setMuted((m) => !m);
                  toggleMute(!muted);
                }}
                className={`w-14 h-14 rounded-full flex items-center justify-center transition ${
                  muted ? "bg-white text-black" : "bg-white/20"
                }`}
              >
                {muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </button>

              {callType === "video" && (
                <button
                  onClick={() => {
                    setCameraOff((c) => !c);
                    toggleCamera(!cameraOff);
                  }}
                  className={`w-14 h-14 rounded-full flex items-center justify-center transition ${
                    cameraOff ? "bg-white text-black" : "bg-white/20"
                  }`}
                >
                  {cameraOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
                </button>
              )}

              <button
                onClick={() => endCall()}
                className="w-16 h-16 rounded-full bg-destructive flex items-center justify-center shadow-soft active:scale-95 transition"
              >
                <PhoneOff className="w-7 h-7" />
              </button>
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}