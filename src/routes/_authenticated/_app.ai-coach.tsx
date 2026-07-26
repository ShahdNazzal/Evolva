import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Bot,
  Send,
  CheckCircle2,
  Dumbbell,
  Flame,
  Apple,
  Mic,
  MicOff,
  Sparkles,
  Shield,
  Moon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { chatbotHandler } from "@/lib/chatbot";
import type { ChatTurn } from "@/lib/chatbot";

export const Route = createFileRoute("/_authenticated/_app/ai-coach")({
  component: AICoachPage,
});

const VALID_GOALS = ["lose_weight", "gain_muscle", "fitness", "tone"] as const;
const VALID_ACTIVITY = ["sedentary", "light", "moderate", "high"] as const;
const VALID_EQUIPMENT = ["home", "gym", "none"] as const;

const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

type Goal = (typeof VALID_GOALS)[number];
type ActivityLevel = (typeof VALID_ACTIVITY)[number];
type Equipment = (typeof VALID_EQUIPMENT)[number];

type ExerciseItem = {
  name: string;
  instruction: string;
  tips: string;
  sets: number;
  reps: number;
};

// نفس بنية أيام الأسبوع الثابت المستخدمة بخطط المستخدمة الشخصية وخطط المدربات
type PlanDay = {
  day_of_week: number;
  is_rest: boolean;
  muscle_group: string | null;
  items: ExerciseItem[];
};

type Plan = {
  name: string;
  description: string;
  goal: Goal;
  activity_level: ActivityLevel;
  equipment: Equipment;
  min_frequency: number;
  exercises: PlanDay[];
};

type ChatMessage =
  | { role: "user"; kind: "text"; text: string }
  | { role: "assistant"; kind: "text"; text: string }
  | { role: "assistant"; kind: "plan"; plan: Plan; saved: boolean };

// نبني مصفوفة 7 أيام دائماً (0-6)، ونملأ أي فراغ أو رد ناقص من الشاتبوت بيوم راحة افتراضي
// عشان تضل الخطة متوافقة 100% مع isFixedWeekPlan() المستخدمة بصفحة التمارين والصفحة الرئيسية
function normalizePlan(raw: any): Plan | null {
  if (!raw || !Array.isArray(raw.exercises)) return null;

  const goal: Goal = (VALID_GOALS as readonly string[]).includes(raw.goal) ? raw.goal : "fitness";
  const activity_level: ActivityLevel = (VALID_ACTIVITY as readonly string[]).includes(raw.activity_level)
    ? raw.activity_level
    : "moderate";
  const equipment: Equipment = (VALID_EQUIPMENT as readonly string[]).includes(raw.equipment) ? raw.equipment : "gym";

  const dayMap = new Map<number, any>();
  raw.exercises.forEach((d: any) => {
    const dow = Number(d?.day_of_week);
    if (Number.isFinite(dow) && dow >= 0 && dow <= 6) dayMap.set(dow, d);
  });

  const exercises: PlanDay[] = Array.from({ length: 7 }, (_, dow) => {
    const d = dayMap.get(dow);
    const items: ExerciseItem[] = Array.isArray(d?.items)
      ? d.items
          .filter((it: any) => it?.name?.trim())
          .map((it: any) => ({
            name: it.name.trim(),
            instruction: typeof it.instruction === "string" ? it.instruction.trim() : "",
            tips: typeof it.tips === "string" ? it.tips.trim() : "",
            sets: Number.isFinite(+it.sets) ? +it.sets : 3,
            reps: Number.isFinite(+it.reps) ? +it.reps : 10,
          }))
      : [];
    const is_rest = !!d?.is_rest || items.length === 0;
    return {
      day_of_week: dow,
      is_rest,
      muscle_group: !is_rest && typeof d?.muscle_group === "string" && d.muscle_group.trim() ? d.muscle_group.trim() : null,
      items: is_rest ? [] : items,
    };
  });

  const hasAnyTraining = exercises.some((d) => !d.is_rest);
  if (!hasAnyTraining) return null;

  const min_frequency =
    Number.isFinite(+raw.min_frequency) && +raw.min_frequency > 0
      ? +raw.min_frequency
      : exercises.filter((d) => !d.is_rest).length;

  return {
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "خطة من AIVA",
    description: typeof raw.description === "string" ? raw.description.trim() : "",
    goal,
    activity_level,
    equipment,
    min_frequency,
    exercises,
  };
}

// اقتراحات جاهزة تُدرج داخل صندوق الكتابة عند الضغط عليها، وتُكمّل المستخدمة الجملة من عندها
const QUICK_PROMPTS: { icon: typeof Dumbbell; label: string; text: string }[] = [
  { icon: Dumbbell, label: "خطة تمرين كاملة", text: "صممي لي خطة تمرين لـ " },
  { icon: Flame, label: "نصيحة تمرين", text: "كم مرة لازم أروح الجيم بالأسبوع؟" },
  { icon: Apple, label: "تغذية رياضية", text: "شو آكل قبل التمرين و بعده؟" },
  { icon: Shield, label: "نصيحة أمان", text: "كيف أحمّي قبل التمرين؟" },
];

function AICoachPage() {
  const { user } = useAuth();

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<any>(null);

  // تهيئة التعرف على الصوت إن كان المتصفح يدعمه (بدون أي كسر إن لم يكن مدعومًا)
  useEffect(() => {
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setVoiceSupported(false);
      return;
    }

    let recognition: any;
    try {
      recognition = new SpeechRecognitionCtor();
      recognition.lang = "ar-SA";
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event: any) => {
        let finalTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i]?.isFinal) {
            finalTranscript += event.results[i][0]?.transcript ?? "";
          }
        }
        if (finalTranscript.trim()) {
          setMessage((prev) => (prev ? `${prev} ${finalTranscript.trim()}` : finalTranscript.trim()));
        }
      };

      recognition.onerror = () => setIsRecording(false);
      recognition.onend = () => setIsRecording(false);

      recognitionRef.current = recognition;
    } catch {
      setVoiceSupported(false);
    }

    return () => {
      try {
        recognition?.stop();
      } catch {
        // تجاهل أي خطأ عند تنظيف التسجيل الصوتي
      }
    };
  }, []);

  // تمرير المحادثة تلقائيًا لآخر رسالة
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // توسعة صندوق الكتابة تلقائيًا حسب طول النص (بدل ما يبقى سطر واحد)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [message]);

  function toggleVoice() {
    if (!voiceSupported || !recognitionRef.current) return;

    if (isRecording) {
      try {
        recognitionRef.current.stop();
      } catch {
        // تجاهل
      }
      setIsRecording(false);
      return;
    }

    try {
      recognitionRef.current.start();
      setIsRecording(true);
    } catch {
      setIsRecording(false);
    }
  }

  // إدراج الاقتراح الجاهز داخل صندوق الكتابة، وترك المؤشر بآخره لتكمل المستخدمة الجملة
  function handleQuickPrompt(text: string) {
    setMessage(text);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.selectionStart = el.selectionEnd = el.value.length;
      }
    });
  }

  // نبني تاريخ المحادثة (نص فقط) عشان نرسله للذكاء الاصطناعي، حتى يقدر يعدّل على خطة سابقة
  function buildHistory(currentMessages: ChatMessage[]): ChatTurn[] {
    return currentMessages.map((m): ChatTurn => {
      if (m.kind === "plan") {
        return { role: "assistant", content: JSON.stringify(m.plan) };
      }
      return { role: m.role, content: m.text };
    });
  }

  async function sendMessage() {
    if (!message.trim() || loading) return;

    if (isRecording) toggleVoice();

    const userMessage = message;
    const historyWithUser: ChatMessage[] = [...messages, { role: "user", kind: "text", text: userMessage }];
    setMessages(historyWithUser);
    setMessage("");
    setLoading(true);

    try {
      const apiHistory = buildHistory(historyWithUser);
      const reply = await chatbotHandler(apiHistory);

      let parsed: any = null;
      try {
        const clean = reply.replace(/```json/gi, "").replace(/```/g, "").trim();
        parsed = JSON.parse(clean);
      } catch {
        parsed = null;
      }

      const plan = normalizePlan(parsed);

      if (plan) {
        setMessages((prev) => [...prev, { role: "assistant", kind: "plan", plan, saved: false }]);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", kind: "text", text: reply }]);
      }
    } catch (e) {
      console.error(e);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", kind: "text", text: "حدث خطأ أثناء التواصل مع AIVA، جرّبي مرة ثانية." },
      ]);
    }

    setLoading(false);
  }

  async function approvePlan(index: number) {
    const msg = messages[index];
    if (msg.kind !== "plan" || msg.saved) return;

    setSaving(true);
    try {
      const { error } = await supabase.from("workouts").insert({
        owner_user_id: user?.id,
        name: msg.plan.name,
        description: msg.plan.description || null,
        goal: msg.plan.goal,
        activity_level: msg.plan.activity_level,
        equipment: msg.plan.equipment,
        min_frequency: msg.plan.min_frequency,
        // نفس بنية الأسبوع الثابت بالضبط (day_of_week + is_rest + muscle_group + items)
        // فهي متوافقة تلقائيًا مع جدولك الأسبوعي وتقويم التقدّم بالصفحة الرئيسية
        exercises: msg.plan.exercises,
        is_public: false,
      });

      if (error) throw error;

      setMessages((prev) => {
        const copy = [...prev];
        copy[index] = { ...(copy[index] as any), saved: true };
        copy.push({
          role: "assistant",
          kind: "text",
          text: "🎉 تم حفظ الخطة بنجاح في تمارينك الشخصية، فيكِ تشوفيها من صفحة التمارين.",
        });
        return copy;
      });
    } catch (e) {
      console.error(e);
      setMessages((prev) => [...prev, { role: "assistant", kind: "text", text: "تعذر حفظ الخطة، جرّبي مرة ثانية." }]);
    } finally {
      setSaving(false);
    }
  }

  const hasMessages = messages.length > 0;

  return (
    <div dir="rtl" className="flex flex-col h-[calc(100dvh-96px)] md:h-[calc(100dvh-48px)] w-full max-w-4xl mx-auto">
      {/* ترويسة AIVA */}
      <div className="flex items-center gap-3 px-1 pb-3 shrink-0">
        <div className="relative">
          <div className="w-11 h-11 rounded-2xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/30">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="absolute -bottom-0.5 -left-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-background" />
        </div>
        <div>
          <h1 className="text-lg font-extrabold leading-tight">AIVA</h1>
          <p className="text-xs text-muted-foreground">مدربتك الذكية للتمارين والتغذية</p>
        </div>
      </div>

      {/* منطقة المحادثة - تأخذ كل المساحة المتاحة */}
      <Card className="flex-1 min-h-0 rounded-3xl border overflow-hidden flex flex-col">
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6">
          {!hasMessages && !loading ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-6 px-2 py-6">
              <div className="w-16 h-16 rounded-3xl gradient-primary flex items-center justify-center shadow-xl shadow-primary/30">
                <Bot className="w-8 h-8 text-white" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-xl font-extrabold">أهلاً بك مع AIVA 👋</h2>
                <p className="text-sm text-muted-foreground max-w-sm">
                  اسأليني عن أي شي يخص تمارينك أو تغذيتك، أو خليني أصمملك خطة تدريب كاملة على مزاجك
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-md">
                {QUICK_PROMPTS.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => handleQuickPrompt(q.text)}
                    className="flex items-center gap-2.5 rounded-2xl border bg-background/80 hover:bg-muted hover:border-primary/40 transition-colors p-3 text-right"
                  >
                    <span className="w-9 h-9 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center">
                      <q.icon className="w-4 h-4 text-primary" />
                    </span>
                    <span className="text-xs font-bold">{q.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((m, i) => {
                if (m.kind === "text") {
                  const isUser = m.role === "user";
                  return (
                    <div key={i} className={`flex items-end gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
                      {!isUser && (
                        <span className="w-8 h-8 rounded-xl gradient-primary flex items-center justify-center shrink-0">
                          <Bot className="w-4 h-4 text-white" />
                        </span>
                      )}
                      <div
                        className={`max-w-[85%] md:max-w-[65%] whitespace-pre-wrap break-words px-4 py-2.5 text-sm leading-relaxed ${
                          isUser
                            ? "bg-primary text-primary-foreground rounded-2xl rounded-tl-sm"
                            : "bg-muted rounded-2xl rounded-tr-sm"
                        }`}
                      >
                        {m.text}
                      </div>
                    </div>
                  );
                }

                // معاينة الخطة — نفس شكل عرض الأيام السبعة تبع جدولك الأسبوعي (يوم راحة / يوم تدريب بعضلته)
                return (
                  <div key={i} className="flex items-start gap-2">
                    <span className="w-8 h-8 rounded-xl gradient-primary flex items-center justify-center shrink-0">
                      <Bot className="w-4 h-4 text-white" />
                    </span>
                    <div className="flex-1 max-w-[92%] md:max-w-[75%] bg-background border rounded-2xl rounded-tr-sm p-4 space-y-3 shadow-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-9 h-9 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center">
                          <Dumbbell className="w-4 h-4 text-primary" />
                        </span>
                        <div>
                          <div className="font-extrabold text-sm">{m.plan.name}</div>
                          {m.plan.description && <p className="text-[11px] text-muted-foreground">{m.plan.description}</p>}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-primary/10 text-primary">
                          {m.plan.min_frequency} أيام/أسبوع
                        </span>
                        <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-muted text-muted-foreground">
                          {m.plan.equipment === "home" ? "بالبيت" : m.plan.equipment === "gym" ? "بالجيم" : "بدون أدوات"}
                        </span>
                      </div>

                      <div className="space-y-3">
                        {m.plan.exercises.map((day, di) => {
                          const label = day.muscle_group ? `${DAYS[day.day_of_week]} - ${day.muscle_group}` : DAYS[day.day_of_week];
                          return (
                            <div key={di} className="space-y-1.5">
                              <div className="text-xs font-bold text-primary flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-primary" /> {label}
                                {day.is_rest && (
                                  <span className="text-[9px] font-bold bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full flex items-center gap-1">
                                    <Moon className="w-2.5 h-2.5" /> راحة
                                  </span>
                                )}
                              </div>
                              {!day.is_rest && (
                                <div className="space-y-1.5">
                                  {day.items.map((ex, ei) => (
                                    <div key={ei} className="bg-muted/60 rounded-xl px-3 py-2 space-y-1">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-bold">{ex.name}</span>
                                        <span className="text-[11px] font-semibold text-primary shrink-0">
                                          {ex.sets} × {ex.reps}
                                        </span>
                                      </div>
                                      {ex.instruction && (
                                        <p className="text-[11px] text-muted-foreground leading-relaxed">{ex.instruction}</p>
                                      )}
                                      {ex.tips && <p className="text-[11px] text-primary leading-relaxed">💡 {ex.tips}</p>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {m.saved ? (
                        <div className="flex items-center gap-1.5 text-xs font-bold text-primary bg-primary/10 rounded-xl px-3 py-2">
                          <CheckCircle2 className="w-4 h-4" /> تم اعتماد هذه الخطة
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <Button
                            size="sm"
                            disabled={saving}
                            onClick={() => approvePlan(i)}
                            className="w-full rounded-xl gradient-primary"
                          >
                            {saving ? "جاري الحفظ..." : "✅ اعتماد الخطة وحفظها"}
                          </Button>
                          <p className="text-[10px] text-muted-foreground text-center">
                            ولو بدك تعديل عليها، اكتبيه كرسالة عادية بالأسفل (مثال: "بدّلي التمرين الأول ليوم الأربعاء")
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {loading && (
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-xl gradient-primary flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 text-white" />
                  </span>
                  <div className="bg-muted rounded-2xl rounded-tr-sm px-4 py-3 flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* شريط اقتراحات سريعة (يظهر فوق صندوق الكتابة بعد بدء المحادثة) */}
      {hasMessages && (
        <div className="flex gap-2 overflow-x-auto pt-2.5 pb-1 px-0.5 shrink-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => handleQuickPrompt(q.text)}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-background hover:bg-muted hover:border-primary/40 transition-colors px-3 py-1.5 text-[11px] font-bold shrink-0"
            >
              <q.icon className="w-3.5 h-3.5 text-primary" />
              {q.label}
            </button>
          ))}
        </div>
      )}

      {/* صندوق الكتابة: Enter لا يرسل، إنما يضيف سطر جديد فقط. الإرسال بالزر */}
      <div className="flex items-end gap-2 shrink-0 pt-2">
        <div className="flex-1 flex items-end gap-1.5 rounded-3xl border bg-background focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10 transition-shadow px-2 py-1.5">
          <button
            type="button"
            onClick={toggleVoice}
            disabled={!voiceSupported}
            title={voiceSupported ? (isRecording ? "إيقاف التسجيل" : "تسجيل صوتي") : "المتصفح لا يدعم الإدخال الصوتي"}
            className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
              isRecording ? "bg-red-500 text-white animate-pulse" : "text-muted-foreground hover:bg-muted"
            } ${!voiceSupported ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="اكتبي سؤالك أو اطلبي خطة تمرين... (مثال: صممي لي خطة لشد الجسم)"
            rows={1}
            className="min-h-[40px] max-h-[200px] resize-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 px-1 py-2 text-sm"
          />
        </div>

        <Button
          type="button"
          onClick={sendMessage}
          disabled={loading || !message.trim()}
          className="w-11 h-11 shrink-0 rounded-full gradient-primary p-0 flex items-center justify-center disabled:opacity-40"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}