import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MessageCircle,
  Send,
  ArrowRight,
  Mic,
  Paperclip,
  Smile,
  Phone,
  Video,
  Play,
  Pause,
  X,
  Trash2,
  Image as ImageIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useCall } from "@/hooks/useCall";
import { CallModal } from "../../components/chat/CallModal";

// نستخدم هاد المتغير بكل استعلامات جدول messages (بما فيها الأعمدة الجديدة
// message_type / media_url / media_duration) لأنه ملف الأنواع التلقائي تبع Supabase
// لسا ما تحدّث ليعرف فيها. لازم تكوني شغّلتي الـ SQL migration قبل استخدام هالملف.
const db = supabase as any;

export const Route = createFileRoute("/_authenticated/_app/chat")({
  head: () => ({ meta: [{ title: "الشات — EVOLVA" }] }),
  // بندعم رابط مباشر لمحادثة معينة: /chat?with=USER_ID
  validateSearch: (search: Record<string, unknown>): { with?: string } => {
    const withId = typeof search.with === "string" ? search.with : undefined;
    return withId ? { with: withId } : {};
  },
  component: ChatPage,
});

type ConvMeta = {
  lastMessage: string;
  messageType: string;
  lastAt: string;
  fromMe: boolean;
  unread: boolean;
};

// -------------------- Helpers --------------------

async function uploadChatMedia(file: Blob | File, userId: string, ext: string) {
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("chat-media").upload(path, file, {
    contentType: (file as any).type || undefined,
  });
  if (error) {
    console.error("uploadChatMedia error:", error);
    toast.error("فشل رفع الملف");
    return null;
  }
  const { data } = supabase.storage.from("chat-media").getPublicUrl(path);
  return data.publicUrl;
}

function previewFor(meta?: ConvMeta) {
  if (!meta) return "اضغطي لبدء المحادثة";
  const prefix = meta.fromMe ? "أنتِ: " : "";
  switch (meta.messageType) {
    case "image":
      return `${prefix}📷 صورة`;
    case "video":
      return `${prefix}🎥 فيديو`;
    case "voice":
      return `${prefix}🎤 رسالة صوتية`;
    case "sticker":
      return `${prefix}${meta.lastMessage}`;
    default:
      return `${prefix}${meta.lastMessage}`;
  }
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// -------------------- Chat list page --------------------

function ChatPage() {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const { with: directId } = Route.useSearch();
  const [convs, setConvs] = useState<any[]>([]);
  const [convsMeta, setConvsMeta] = useState<Record<string, ConvMeta>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // نجيب آخر رسالة + حالة القراءة + نوعها لكل محادثة
  const loadConvsMeta = async (userId: string, otherIds: string[]) => {
    if (otherIds.length === 0) return;
    const { data: msgs, error } = await db
      .from("messages")
      .select("sender_id, recipient_id, content, created_at, read, message_type")
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("loadConvsMeta error:", error);
      return;
    }

    const meta: Record<string, ConvMeta> = {};
    for (const m of msgs ?? []) {
      const otherId = m.sender_id === userId ? m.recipient_id : m.sender_id;
      if (!otherIds.includes(otherId)) continue;
      if (meta[otherId]) continue; // أول ظهور = أحدث رسالة لأنها مرتبة تنازلياً أصلاً
      meta[otherId] = {
        lastMessage: m.content,
        messageType: m.message_type ?? "text",
        lastAt: m.created_at,
        fromMe: m.sender_id === userId,
        unread: m.sender_id !== userId && m.read === false,
      };
    }
    setConvsMeta(meta);
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      let members: any[] = [];

      if (role === "trainer") {
        const { data: trainerRoles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("role", "trainer");
        const trainerIds = new Set((trainerRoles ?? []).map((r) => r.user_id));
        const { data: allProfiles } = await supabase.from("profiles").select("*");
        members = (allProfiles ?? []).filter((p) => p.id !== user.id && !trainerIds.has(p.id));
      } else {
        const { data: allProfiles } = await supabase.from("profiles").select("*");
        members = (allProfiles ?? []).filter((p) => p.id !== user.id);
      }

      setConvs(members);
      await loadConvsMeta(user.id, members.map((m) => m.id));
      setLoading(false);
    })();
  }, [user, role]);

  // تحديث فوري لما توصل/تنقرأ رسائل ونحنا واقفين على قائمة المحادثات
  useEffect(() => {
    if (!user || convs.length === 0) return;
    const otherIds = convs.map((c) => c.id);

    const channel = supabase
      .channel(`chat-list-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload: any) => {
          const m = payload.new;
          if (m.sender_id === user.id || m.recipient_id === user.id) {
            loadConvsMeta(user.id, otherIds);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload: any) => {
          const m = payload.new;
          if (m.sender_id === user.id || m.recipient_id === user.id) {
            loadConvsMeta(user.id, otherIds);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, convs]);

  const sortedConvs = useMemo(() => {
    return [...convs].sort((a, b) => {
      const metaA = convsMeta[a.id];
      const metaB = convsMeta[b.id];
      if (metaA && metaB) return new Date(metaB.lastAt).getTime() - new Date(metaA.lastAt).getTime();
      if (metaA && !metaB) return -1;
      if (!metaA && metaB) return 1;
      return 0;
    });
  }, [convs, convsMeta]);

  const openConversation = async (otherId: string) => {
    setSelected(otherId);
    await db.from("messages").update({ read: true }).eq("recipient_id", user!.id).eq("sender_id", otherId).eq("read", false);
    setConvsMeta((prev) => (prev[otherId] ? { ...prev, [otherId]: { ...prev[otherId], unread: false } } : prev));
  };

  const activeOtherId = selected ?? directId;

  const handleBack = () => {
    if (directId) {
      navigate({ to: "/chat" });
      return;
    }
    setSelected(null);
    if (user) loadConvsMeta(user.id, convs.map((c) => c.id));
  };

  if (activeOtherId) {
    const otherProfile = convs.find((c) => c.id === activeOtherId);
    return (
      <ChatView
        userId={user!.id}
        otherId={activeOtherId}
        otherNameFallback={otherProfile?.full_name}
        onBack={handleBack}
      />
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">الشات</h1>

      {loading && <p className="text-sm text-muted-foreground text-center py-8">جارِ التحميل...</p>}

      {!loading && convs.length === 0 && (
        <Card className="p-8 text-center rounded-3xl border-dashed">
          <MessageCircle className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            {role === "trainer" ? "لا يوجد أعضاء بعد" : "لا يوجد أعضاء أو مدربات مسجلات بعد"}
          </p>
        </Card>
      )}

      <div className="space-y-2">
        {sortedConvs.map((c) => {
          const meta = convsMeta[c.id];
          const preview = previewFor(meta);
          const isUnread = !!meta?.unread;

          return (
            <button key={c.id} onClick={() => openConversation(c.id)} className="w-full text-right">
              <Card className="p-4 rounded-2xl flex items-center gap-3 hover:shadow-soft transition">
                <div className="relative shrink-0">
                  <div className="w-12 h-12 rounded-2xl gradient-primary text-primary-foreground flex items-center justify-center font-extrabold">
                    {c.full_name?.[0] ?? "؟"}
                  </div>
                  {isUnread && (
                    <div className="absolute -top-1 -left-1 w-3.5 h-3.5 rounded-full bg-destructive border-2 border-background" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`truncate ${isUnread ? "font-extrabold" : "font-bold"}`}>{c.full_name}</div>
                  <div className={`text-xs truncate mt-0.5 ${isUnread ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                    {preview}
                  </div>
                </div>
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// -------------------- Voice message bubble player --------------------

function VoiceBubble({ url, duration, mine }: { url: string; duration?: number; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause();
    else audioRef.current.play();
  };

  return (
    <div className="flex items-center gap-2 w-48">
      <button
        onClick={toggle}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition ${
          mine ? "bg-white/25" : "bg-primary/15"
        }`}
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <div className="flex-1 h-1.5 rounded-full bg-current/15 overflow-hidden">
        <div className="h-full bg-current opacity-70 transition-all" style={{ width: `${progress * 100}%` }} />
      </div>
      <span className="text-[10px] opacity-70 w-8 text-left">{duration ? `${duration}s` : ""}</span>
      <audio
        ref={audioRef}
        src={url}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          if (a.duration) setProgress(a.currentTime / a.duration);
        }}
      />
    </div>
  );
}

const STICKERS = ["💪", "🔥", "❤️", "👏", "🎉", "😅", "😍", "🙌", "🥵", "✨", "🏋️‍♀️", "🤸‍♀️"];

// -------------------- Chat view (conversation) --------------------

function ChatView({ userId, otherId, otherNameFallback, onBack }: any) {
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [other, setOther] = useState<any>(otherNameFallback ? { full_name: otherNameFallback } : null);
  const [showStickers, setShowStickers] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(Array(24).fill(4));

  const endRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunks = useRef<BlobPart[]>([]);
  const recordTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelsTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);

  const call = useCall(userId, otherId);

  const markAsRead = async () => {
    const { error } = await db
      .from("messages")
      .update({ read: true })
      .eq("recipient_id", userId)
      .eq("sender_id", otherId)
      .eq("read", false);
    if (error) console.error("markAsRead error:", error);
  };

  useEffect(() => {
    (async () => {
      const { data: o } = await supabase.from("profiles").select("*").eq("id", otherId).maybeSingle();
      if (o) setOther(o);
      const { data: msgs, error } = await db
        .from("messages")
        .select("*")
        .or(`and(sender_id.eq.${userId},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${userId})`)
        .order("created_at");
      if (error) console.error("load messages error:", error);
      setMessages(msgs ?? []);
      await markAsRead();
    })();

    const channel = supabase
      .channel(`chat-${userId}-${otherId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const m = payload.new as any;
        if ((m.sender_id === userId && m.recipient_id === otherId) || (m.sender_id === otherId && m.recipient_id === userId)) {
          setMessages((prev) => [...prev, m]);
          if (m.recipient_id === userId && m.sender_id === otherId) {
            markAsRead();
          }
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, otherId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // -------------------- Sending --------------------

  const sendMessage = async (payload: {
    content: string;
    message_type: string;
    media_url?: string | null;
    media_duration?: number | null;
  }) => {
    const { error } = await db.from("messages").insert({
      sender_id: userId,
      recipient_id: otherId,
      content: payload.content,
      message_type: payload.message_type,
      media_url: payload.media_url ?? null,
      media_duration: payload.media_duration ?? null,
    });
    if (error) {
      console.error("sendMessage error:", error);
      toast.error("لم يتم الإرسال");
    }
  };

  const send = async () => {
    if (!text.trim()) return;
    const content = text;
    setText("");
    await sendMessage({ content, message_type: "text" });
  };

  const sendSticker = async (emoji: string) => {
    setShowStickers(false);
    await sendMessage({ content: emoji, message_type: "sticker" });
  };

  // -------------------- File / image / video upload --------------------

  const handlePickFile = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) {
      toast.error("الملف لازم يكون صورة أو فيديو");
      return;
    }

    setUploading(true);
    const ext = file.name.split(".").pop() || (isImage ? "jpg" : "mp4");
    const url = await uploadChatMedia(file, userId, ext);
    setUploading(false);

    if (!url) return;
    await sendMessage({
      content: isImage ? "📷 صورة" : "🎥 فيديو",
      message_type: isImage ? "image" : "video",
      media_url: url,
    });
  };

  // -------------------- Voice recording --------------------

  const startRecording = async () => {
    try {
      cancelledRef.current = false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordChunks.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordChunks.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (levelsTimer.current) clearInterval(levelsTimer.current);
        audioCtxRef.current?.close().catch(() => {});
        audioCtxRef.current = null;

        if (cancelledRef.current) {
          recordChunks.current = [];
          return;
        }

        const blob = new Blob(recordChunks.current, { type: "audio/webm" });
        recordChunks.current = [];
        if (blob.size < 500) return; // تسجيل قصير جداً، تجاهليه

        setUploading(true);
        const url = await uploadChatMedia(blob, userId, "webm");
        setUploading(false);
        if (!url) return;

        await sendMessage({
          content: "🎤 رسالة صوتية",
          message_type: "voice",
          media_url: url,
          media_duration: recordSeconds,
        });
      };

      recorder.start();
      setIsRecording(true);
      setRecordSeconds(0);

      recordTimer.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);

      // ويفورم حي بسيط عبر Web Audio API
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      levelsTimer.current = setInterval(() => {
        analyser.getByteFrequencyData(data);
        const chunks: number[] = [];
        const step = Math.floor(data.length / 24) || 1;
        for (let i = 0; i < 24; i++) {
          const v = data[i * step] || 0;
          chunks.push(Math.max(4, Math.min(28, (v / 255) * 28)));
        }
        setLevels(chunks);
      }, 100);
    } catch (err) {
      console.error("startRecording error:", err);
      toast.error("ما قدرنا نوصل للمايكروفون");
    }
  };

  const stopRecording = (cancel: boolean) => {
    cancelledRef.current = cancel;
    if (recordTimer.current) clearInterval(recordTimer.current);
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  useEffect(() => {
    return () => {
      if (recordTimer.current) clearInterval(recordTimer.current);
      if (levelsTimer.current) clearInterval(levelsTimer.current);
      recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-140px)]">
      <input type="file" ref={fileInputRef} accept="image/*,video/*" className="hidden" onChange={handleFileChange} />

      <CallModal call={call} otherName={other?.full_name ?? ""} />

      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <button className="absolute top-6 left-6 text-white" onClick={() => setPreviewImage(null)}>
            <X className="w-7 h-7" />
          </button>
          <img src={previewImage} className="max-w-full max-h-full rounded-2xl object-contain" />
        </div>
      )}

      <div className="flex items-center gap-3 pb-3 border-b">
        <Button variant="ghost" size="icon" onClick={onBack} className="rounded-xl">
          <ArrowRight className="w-5 h-5" />
        </Button>
        <div className="w-10 h-10 rounded-xl gradient-primary text-primary-foreground flex items-center justify-center font-bold">
          {other?.full_name?.[0]}
        </div>
        <div className="font-bold flex-1">{other?.full_name}</div>

        <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => call.startCall("audio")}>
          <Phone className="w-5 h-5" />
        </Button>
        <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => call.startCall("video")}>
          <Video className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-4 space-y-2">
        {messages.map((m) => {
          const mine = m.sender_id === userId;
          const type = m.message_type ?? "text";

          return (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              key={m.id}
              className={`flex ${mine ? "justify-start" : "justify-end"}`}
            >
              {type === "sticker" ? (
                <div className="text-4xl px-2">{m.content}</div>
              ) : (
                <div
                  className={`max-w-[75%] p-3 rounded-2xl text-sm ${
                    mine ? "gradient-primary text-primary-foreground rounded-bl-sm" : "bg-muted rounded-br-sm"
                  } ${type === "image" || type === "video" ? "p-1.5" : ""}`}
                >
                  {type === "image" && m.media_url && (
                    <img
                      src={m.media_url}
                      onClick={() => setPreviewImage(m.media_url)}
                      className="rounded-xl max-w-[220px] max-h-[280px] object-cover cursor-pointer"
                    />
                  )}

                  {type === "video" && m.media_url && (
                    <video src={m.media_url} controls className="rounded-xl max-w-[240px] max-h-[280px]" />
                  )}

                  {type === "voice" && m.media_url && (
                    <VoiceBubble url={m.media_url} duration={m.media_duration} mine={mine} />
                  )}

                  {type === "text" && m.content}

                  <div className={`text-[10px] mt-1 ${mine ? "opacity-80" : "text-muted-foreground"} ${type === "image" || type === "video" ? "px-1.5 pb-0.5" : ""}`}>
                    {new Date(m.created_at).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              )}
            </motion.div>
          );
        })}
        <div ref={endRef} />
      </div>

      <AnimatePresence>
        {showStickers && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-6 gap-2 py-3 px-1">
              {STICKERS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendSticker(s)}
                  className="text-2xl p-2 rounded-xl hover:bg-muted transition active:scale-90"
                >
                  {s}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-2 pt-2 border-t">
        {isRecording ? (
          <div className="flex-1 flex items-center gap-2 bg-destructive/10 rounded-2xl px-3 h-11">
            <button onClick={() => stopRecording(true)} className="text-destructive shrink-0">
              <Trash2 className="w-5 h-5" />
            </button>
            <div className="flex-1 flex items-center gap-[3px] h-6 overflow-hidden">
              {levels.map((lvl, i) => (
                <div
                  key={i}
                  className="w-1 rounded-full bg-destructive transition-all duration-100"
                  style={{ height: `${lvl}px` }}
                />
              ))}
            </div>
            <span className="text-xs font-bold text-destructive shrink-0">{formatTime(recordSeconds)}</span>
          </div>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-2xl shrink-0"
              onClick={() => setShowStickers((s) => !s)}
              disabled={uploading}
            >
              <Smile className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="icon" className="rounded-2xl shrink-0" onClick={handlePickFile} disabled={uploading}>
              <Paperclip className="w-5 h-5" />
            </Button>
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder={uploading ? "جارِ الرفع..." : "اكتبي رسالة..."}
              className="rounded-2xl"
              disabled={uploading}
            />
          </>
        )}

        {text.trim() && !isRecording ? (
          <Button onClick={send} className="rounded-2xl gradient-primary shrink-0" disabled={uploading}>
            <Send className="w-4 h-4" />
          </Button>
        ) : (
          <Button
            className={`rounded-2xl shrink-0 ${isRecording ? "bg-destructive" : "gradient-primary"}`}
            onMouseDown={startRecording}
            onMouseUp={() => isRecording && stopRecording(false)}
            onMouseLeave={() => isRecording && stopRecording(true)}
            onTouchStart={(e) => {
              e.preventDefault();
              startRecording();
            }}
            onTouchEnd={() => isRecording && stopRecording(false)}
            disabled={uploading}
          >
            <Mic className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}