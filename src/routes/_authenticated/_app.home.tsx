import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import {
  Flame,
  TrendingUp,
  TrendingDown,
  Minus,
  Dumbbell,
  Apple,
  MessageCircle,
  Sparkles,
  Clock,
  Users,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  CalendarDays,
  Moon,
  CheckCircle2,
  Ruler,
  Weight,
  Target,
  Activity,
} from "lucide-react";
import { bmiCategory, GOAL_LABELS, ACTIVITY_LABELS, type Goal, type ActivityLevel } from "@/lib/workout-rules";
import { Skeleton } from "@/components/ui/skeleton";

// نستخدم هاد المتغير بكل استعلامات عمود "read" لأنه ملف الأنواع التلقائي تبع Supabase
// لسا ما تحدّث ليعرف بعمود read الجديد بجدول messages. هيك بنتفادى أخطاء TypeScript.
const db = supabase as any;

// جدول workout_logs فيه عمودين جديدين (day_index و exercise_index) مش موجودين بعد بملف الأنواع
// المولّد تلقائياً تبع Supabase — نفس فكرة "db" فوق، بس مخصص لجدول workout_logs
const workoutLogsTable = () => (supabase as any).from("workout_logs");

// جدول user_fitness_profile فيه أعمدة (goal, activity_level, weight, height, frequency, bmi)
// مش كلها موجودة بملف الأنواع التلقائي دايماً، فبنعامله كـ any عشان نضمن ما في أخطاء تايبسكريبت
const fitnessProfileTable = () => (supabase as any).from("user_fitness_profile");

const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const DAYS_SHORT = ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];

export const Route = createFileRoute("/_authenticated/_app/home")({
  head: () => ({ meta: [{ title: "الرئيسية — EVOLVA" }] }),
  component: HomePage,
});

// خطة "أسبوع ثابت" = مصفوفة من 7 عناصر بالظبط، كل عنصر فيه day_of_week رقمي (نفس البنية المستخدمة بصفحة التمارين)
function isFixedWeekPlan(plan: any): boolean {
  const days = Array.isArray(plan?.exercises) ? plan.exercises : [];
  return days.length === 7 && days.every((d: any) => d?.day_of_week != null);
}

// نحوّل تاريخ لصيغة "YYYY-MM-DD" محلية (بدون أي تحويل تايم زون) عشان نقارن الأيام ببعض بدقة
function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function HomePage() {
  const { user, role } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [fp, setFp] = useState<any>(null);

  const [streak, setStreak] = useState(0);
  const [weeklyDaysTrained, setWeeklyDaysTrained] = useState(0);

  // الخطة النشطة حالياً (شخصية أو من مدربة) — نفس الجدول والمنطق المستخدم بصفحة التمارين
  const [activeWorkout, setActiveWorkout] = useState<any>(null);
  // مصدر الخطة النشطة (نوعها ومعرّفها) — لازم نعرفهم عشان نقدر نجيب سجلات الإنجاز الصحيحة للتقويم
  const [activeWorkoutSource, setActiveWorkoutSource] = useState<{ type: "trainer" | "personal"; id: string } | null>(null);

  const [weightLogs, setWeightLogs] = useState<any[]>([]);
  const [nutritionPlan, setNutritionPlan] = useState<any>(null);

  const [loading, setLoading] = useState(true);
  // بنخزن معرفات الأشخاص يلي عندهم رسائل غير مقروءة (مش عدد الرسائل)
  const [unreadSenderIds, setUnreadSenderIds] = useState<Set<string>>(new Set());
  const unreadCount = unreadSenderIds.size;

  const loadUnread = async (userId: string) => {
    const { data, error } = await db
      .from("messages")
      .select("sender_id")
      .eq("recipient_id", userId)
      .eq("read", false);
    if (error) {
      console.error("loadUnread error:", error);
      return;
    }
    setUnreadSenderIds(new Set((data ?? []).map((m: any) => m.sender_id)));
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
     try {
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setHours(0, 0, 0, 0);
      weekStart.setDate(now.getDate() - now.getDay());

      const [{ data: p }, { data: f }, { data: logs }, { data: sel }, { data: weights }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        fitnessProfileTable().select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("workout_logs").select("completed_at").eq("user_id", user.id).order("completed_at", { ascending: false }),
        supabase.from("active_plan_selection").select("*").eq("user_id", user.id).maybeSingle(),
        supabase
          .from("progress_logs")
          .select("weight, logged_at")
          .eq("user_id", user.id)
          .order("logged_at", { ascending: false })
          .limit(2),
      ]);

      setProfile(p);
      setFp(f);
      setWeightLogs(weights ?? []);

      if (logs && logs.length) {
        // نجمع تواريخ التمارين (يوم واحد بغض النظر عن عدد التمارين المسجّلة فيه)
        const uniqueDays = new Set(logs.map((l) => new Date(l.completed_at).toDateString()));

        // ستريك: عدد الأيام المتتالية اللي فيها تمرين، رجوعًا من اليوم
        let s = 0;
        const d = new Date();
        while (uniqueDays.has(d.toDateString())) {
          s++;
          d.setDate(d.getDate() - 1);
        }
        setStreak(s);

        // عدد الأيام (المختلفة) اللي تمرّنت فيها هالأسبوع — مش عدد التمارين
        const daysThisWeek = [...uniqueDays].filter((ds) => new Date(ds) >= weekStart).length;
        setWeeklyDaysTrained(daysThisWeek);
      }

      // الخطة النشطة (تمرين) وخطة التغذية — كانوا عم يتجابوا بالتسلسل (كل استعلام ينتظر
      // اللي قبله)، وهاد بالذات يلي كان يبطّئ ظهور الصفحة للمستخدمة الجديدة (يلي عندها
      // fp من الـ onboarding بس لسا ما عندها active_plan_selection كامل، فكانت تضرب
      // سلسلة استعلامين متتاليين إضافيين بس عشان توصل لـ null). هلق الاثنين (تمرين + تغذية)
      // منجيبهم بالتوازي مع بعض (Promise.all)، ودمجنا جولتي التغذية (خطة خاصة ثم خطة عامة)
      // بجولة واحدة بدل اثنتين متتاليتين.

      const workoutPromise = sel?.workout_plan_id
        ? supabase.from("workouts").select("*").eq("id", sel.workout_plan_id).maybeSingle()
        : Promise.resolve({ data: null } as any);

      let nutritionPromise: PromiseLike<any>;
      if (sel?.nutrition_plan_id) {
        nutritionPromise = supabase.from("nutrition_plans").select("*").eq("id", sel.nutrition_plan_id).maybeSingle();
      } else if (f) {
        // استعلام واحد بيرجع خطتها الخاصة (owner_user_id) وأحدث خطة عامة مناسبة لهدفها معاً،
        // وبعدين منفضّل الخاصة إذا موجودة أثناء معالجة النتيجة بالـ JS بدل استعلامين متتاليين
        nutritionPromise = supabase
          .from("nutrition_plans")
          .select("*")
          .or(`owner_user_id.eq.${user.id},and(is_public.eq.true,goal.eq.${f.goal})`)
          .order("created_at", { ascending: false });
      } else {
        nutritionPromise = Promise.resolve({ data: null } as any);
      }

      const [{ data: w }, nutritionResult] = await Promise.all([workoutPromise, nutritionPromise]);

      // الخطة النشطة: نفس منطق صفحة التمارين بالضبط (workout_plan_type + workout_plan_id)
      if (sel?.workout_plan_id) {
        setActiveWorkout(w ?? null);
        setActiveWorkoutSource(w ? { type: sel.workout_plan_type, id: sel.workout_plan_id } : null);
      } else {
        setActiveWorkout(null);
        setActiveWorkoutSource(null);
      }

      // خطة التغذية: نفضّل الخطة المعتمدة صراحة، وإلا خطة خاصة، وإلا أقرب خطة عامة لهدفها
      if (sel?.nutrition_plan_id) {
        setNutritionPlan(nutritionResult?.data ?? null);
      } else if (f) {
        const rows: any[] = nutritionResult?.data ?? [];
        const myPlan = rows.find((r) => r.owner_user_id === user.id);
        setNutritionPlan(myPlan ?? rows[0] ?? null);
      } else {
        setNutritionPlan(null);
      }

     } catch (err) {
       // أي خطأ صار بأي استعلام فوق (RLS، شبكة، إلخ) رح يبين هون بالتفصيل بدل ما الصفحة تعلق عالتحميل للأبد
       console.error("home page load error:", err);
     } finally {
       setLoading(false);
       loadUnread(user.id);
     }
    })();
  }, [user]);

  // تحديث فوري لعدد الأشخاص أصحاب الرسائل غير المقروءة
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`home-unread-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${user.id}` },
        (payload: any) => {
          const m = payload.new;
          if (m.read === false) {
            setUnreadSenderIds((prev) => new Set(prev).add(m.sender_id));
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `recipient_id=eq.${user.id}` },
        () => {
          loadUnread(user.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const greeting =
    new Date().getHours() < 12 ? "صباح الخير" : new Date().getHours() < 18 ? "مساء النور" : "مساؤك ورد";

  const todayLabel = `${DAYS[new Date().getDay()]}، ${new Intl.DateTimeFormat("ar", {
    day: "numeric",
    month: "long",
  }).format(new Date())}`;

  // هدف عدد أيام التمرين بالأسبوع: نفضّل هدف الخطة النشطة نفسها لأنه أدق من هدف عام بالبروفايل
  const weeklyGoal = activeWorkout?.min_frequency ?? fp?.frequency ?? 0;

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <p className="text-muted-foreground text-sm">
          {greeting} · {todayLabel}
        </p>
        <h1 className="text-3xl font-extrabold mt-1">{profile?.full_name ?? "أهلاً"}</h1>
      </motion.div>

      {loading ? (
        <PreparingDataScreen />
      ) : (
        <>
          {role === "user" && (
            <>
              <TodayWorkoutHero activeWorkout={activeWorkout} />

              <div className="grid grid-cols-2 gap-3">
                <WeeklyProgressCard completed={weeklyDaysTrained} goal={weeklyGoal} streak={streak} />
                <BodyStatsCard fp={fp} weightLogs={weightLogs} />
              </div>

              {/* تقويم التقدّم: بيعرض جدولك الأسبوعي متكرر على كل أيام الشهر، ولما تخلّصي تمارين يوم معيّن بينشطب تلقائياً */}
              {activeWorkout && activeWorkoutSource && isFixedWeekPlan(activeWorkout) ? (
                <WorkoutCalendarCard
                  activeWorkout={activeWorkout}
                  userId={user!.id}
                  sourceType={activeWorkoutSource.type}
                  sourceId={activeWorkoutSource.id}
                />
              ) : (
                <Card className="p-4 rounded-2xl border-dashed text-center text-xs text-muted-foreground">
                  اعتمدي خطة بجدول أسبوعي ثابت (من صفحة التمارين) عشان يظهر هون تقويم تقدمك اليومي
                </Card>
              )}

              <NutritionSnippetCard plan={nutritionPlan} fp={fp} />

              <div className="grid grid-cols-2 gap-3">
                <QuickAction to="/trainers" icon={<Users className="w-5 h-5" />} title="اكتشفي مدربات" />
                <QuickAction to="/chat" icon={<MessageCircle className="w-5 h-5" />} title="الشات" badge={unreadCount} />
              </div>
            </>
          )}

          {role === "trainer" && <TrainerHome userId={user!.id} unreadCount={unreadCount} />}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* شاشة "عم نجهّزلك بياناتك" — بتظهر بمكان كل الـ Skeletons المتفرقة      */
/* أثناء أول تحميل للصفحة (بالذات المستخدمة الجديدة بعد الـ onboarding)   */
/* ------------------------------------------------------------------ */

function PreparingDataScreen() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center text-center py-16 gap-4"
    >
      <motion.div
        animate={{ scale: [1, 1.08, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center shadow-elegant"
      >
        <Sparkles className="w-8 h-8 text-primary-foreground" />
      </motion.div>
      <div>
        <h2 className="font-extrabold text-lg">عم نجهّزلك كل شي...</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-[240px]">
          لحظات بسيطة وبتكون خطتك وبياناتك جاهزة ✨
        </p>
      </div>
    </motion.div>
  );
}
/* ------------------------------------------------------------------ */
/* البطل: تمرين اليوم — مبني فعلياً على الخطة المعتمدة بصفحة التمارين     */
/* ------------------------------------------------------------------ */

function TodayWorkoutHero({ activeWorkout }: { activeWorkout: any }) {
  const todayIdx = new Date().getDay();

  // حالة: ما في خطة نشطة أصلاً
  if (!activeWorkout) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative overflow-hidden rounded-3xl p-6 bg-card border border-border shadow-soft text-center"
      >
        <CalendarDays className="w-8 h-8 text-primary mx-auto mb-2" />
        <h2 className="font-extrabold">ما في خطة تمرين نشطة حالياً</h2>
        <p className="text-sm text-muted-foreground mt-1">
          اعتمدي خطة شخصية أو خطة من إحدى المدربات عشان تبداي تشوفي هون تمرين كل يوم بالتفصيل
        </p>
        <Link to="/workouts" className="block mt-4">
          <div className="inline-flex items-center gap-2 bg-secondary text-primary font-bold rounded-2xl px-5 py-2.5 text-sm">
            اختاري خطتك <ChevronLeft className="w-4 h-4" />
          </div>
        </Link>
      </motion.div>
    );
  }

  const fixedWeek = isFixedWeekPlan(activeWorkout);
  const rawDays: any[] = Array.isArray(activeWorkout.exercises) ? activeWorkout.exercises : [];
  const todayEntry = fixedWeek ? rawDays.find((d) => Number(d.day_of_week) === todayIdx) : null;
  const isRest = fixedWeek ? !todayEntry || !!todayEntry.is_rest : null; // null = بنية قديمة، ما فينا نحدد
  const items: any[] = Array.isArray(todayEntry?.items) ? todayEntry.items : [];
  const muscleGroup: string | null = todayEntry?.muscle_group || null;

  // واحد كرت موحّد: اسم الخطة + وصفها فوق، وتحته "تمرين اليوم" بخط كبير وواضح
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative overflow-hidden rounded-3xl p-6 gradient-primary text-primary-foreground shadow-elegant"
    >
      <div className="absolute -top-10 -left-10 w-40 h-40 bg-white/10 rounded-full blur-2xl" />
      <div className="absolute -bottom-14 -right-8 w-44 h-44 bg-white/10 rounded-full blur-2xl" />
      <div className="relative">
        <div className="flex items-center gap-2 opacity-90 text-sm">
          <Dumbbell className="w-4 h-4" /> خطتك الحالية
        </div>
        <h2 className="text-xl font-extrabold mt-1">{activeWorkout.name}</h2>
        {activeWorkout.description && (
          <p className="text-sm opacity-90 mt-1 line-clamp-2">{activeWorkout.description}</p>
        )}

        <div className="mt-4 bg-white/15 rounded-2xl p-4">
          <div className="text-xs opacity-90">تمرين اليوم</div>

          {isRest === null && (
            <div className="text-lg font-extrabold mt-1">افتحي الجدول لمعرفة تفاصيل اليوم</div>
          )}

          {isRest === true && (
            <div className="flex items-center gap-2 mt-1">
              <Moon className="w-6 h-6" />
              <span className="text-2xl font-extrabold">يوم راحة</span>
            </div>
          )}

          {isRest === false && (
            <>
              <div className="text-3xl font-extrabold mt-1">{muscleGroup || "تمرين عام"}</div>
              {items.length > 0 && (
                <div className="flex items-center gap-1 text-xs opacity-90 mt-1.5">
                  <Clock className="w-3.5 h-3.5" /> {items.length} تمارين · ~{items.length * 20} د تقريبًا
                </div>
              )}
            </>
          )}
        </div>

        <Link to="/workouts" className="block mt-4">
          <div className="flex items-center justify-center gap-2 bg-white text-primary font-extrabold rounded-2xl py-3 text-sm shadow-soft active:scale-[0.98] transition">
            افتحي جدولك الأسبوعي <ChevronLeft className="w-4 h-4" />
          </div>
        </Link>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* تقويم التقدّم: جدولك الأسبوعي متكرر على كل أيام الشهر + تشطيب الأيام المنجزة */
/* ------------------------------------------------------------------ */

type WeekdaySchedule = { label: string; isRest: boolean; itemsCount: number };

function WorkoutCalendarCard({
  activeWorkout,
  userId,
  sourceType,
  sourceId,
}: {
  activeWorkout: any;
  userId: string;
  sourceType: "trainer" | "personal";
  sourceId: string;
}) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [completedDates, setCompletedDates] = useState<Set<string>>(new Set());
  const [loadingCal, setLoadingCal] = useState(true);

  // خريطة: رقم اليوم بالأسبوع (0-6) -> تسمية العضلة/التمرين المجدولة له + هل هو يوم راحة + عدد تمارينه
  const scheduleByWeekday = useMemo(() => {
    const map = new Map<number, WeekdaySchedule>();
    const rawDays: any[] = Array.isArray(activeWorkout?.exercises) ? activeWorkout.exercises : [];
    rawDays.forEach((d: any) => {
      const itemsCount = Array.isArray(d.items) ? d.items.length : 0;
      const isRest = !!d.is_rest || itemsCount === 0;
      map.set(Number(d.day_of_week), {
        label: isRest ? "راحة" : (d.muscle_group?.trim() || "تمرين"),
        isRest,
        itemsCount,
      });
    });
    return map;
  }, [activeWorkout]);

  // حدود الشهر المعروض + خانات الشبكة (بما فيها أيام من الشهر السابق/التالي لتعبئة الأسبوع)
  const { year, month, monthLabel, gridStart, gridEnd, cells } = useMemo(() => {
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() + monthOffset);
    const y = base.getFullYear();
    const m = base.getMonth();

    const firstOfMonth = new Date(y, m, 1);
    const lastOfMonth = new Date(y, m + 1, 0);
    const gStart = new Date(firstOfMonth);
    gStart.setDate(gStart.getDate() - gStart.getDay());
    const gEnd = new Date(lastOfMonth);
    gEnd.setDate(gEnd.getDate() + (6 - gEnd.getDay()));

    const list: Date[] = [];
    const cursor = new Date(gStart);
    while (cursor <= gEnd) {
      list.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    return {
      year: y,
      month: m,
      monthLabel: new Intl.DateTimeFormat("ar", { month: "long", year: "numeric" }).format(base),
      gridStart: gStart,
      gridEnd: gEnd,
      cells: list,
    };
  }, [monthOffset]);

  useEffect(() => {
    if (!userId || !sourceId) {
      setLoadingCal(false);
      return;
    }
    (async () => {
      setLoadingCal(true);
      const rangeStart = new Date(gridStart);
      rangeStart.setHours(0, 0, 0, 0);
      const rangeEnd = new Date(gridEnd);
      rangeEnd.setHours(23, 59, 59, 999);

      const { data, error } = await workoutLogsTable()
        .select("completed_at, day_index, exercise_index")
        .eq("user_id", userId)
        .eq("source_type", sourceType)
        .eq("source_id", sourceId)
        .gte("completed_at", rangeStart.toISOString())
        .lte("completed_at", rangeEnd.toISOString());

      if (error) {
        console.error("workout calendar load error:", error);
        setCompletedDates(new Set());
        setLoadingCal(false);
        return;
      }

      // بنجمع، لكل (تاريخ + رقم اليوم بالأسبوع المسجّل فعلياً بالسجل)، مجموعة أرقام التمارين المنجزة
      const grouped = new Map<string, Set<number>>();
      (data ?? []).forEach((row: any) => {
        if (row.day_index === null || row.day_index === undefined) return;
        const d = new Date(row.completed_at);
        const dateKey = toDateKey(d);
        const groupKey = `${dateKey}|${row.day_index}`;
        if (!grouped.has(groupKey)) grouped.set(groupKey, new Set());
        if (row.exercise_index !== null && row.exercise_index !== undefined) {
          grouped.get(groupKey)!.add(row.exercise_index);
        }
      });

      // نحدد الأيام "المكتملة": التاريخ اللي فيه، بيوم أسبوعه الحقيقي هو نفسه، تم تسجيل كل التمارين المجدولة إله
      const done = new Set<string>();
      cells.forEach((cellDate) => {
        const weekday = cellDate.getDay();
        const sched = scheduleByWeekday.get(weekday);
        if (!sched || sched.isRest || sched.itemsCount === 0) return;
        const dateKey = toDateKey(cellDate);
        const groupKey = `${dateKey}|${weekday}`;
        const doneSet = grouped.get(groupKey);
        if (doneSet && doneSet.size >= sched.itemsCount) {
          done.add(dateKey);
        }
      });

      setCompletedDates(done);
      setLoadingCal(false);
    })();
  }, [userId, sourceType, sourceId, monthOffset, scheduleByWeekday]);

  const todayKey = toDateKey(new Date());

  return (
    <Card className="p-4 rounded-2xl border-none shadow-soft">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setMonthOffset((v) => v - 1)}
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-muted transition"
          aria-label="الشهر السابق"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <div className="font-bold text-sm flex items-center gap-1.5">
          <CalendarDays className="w-4 h-4 text-primary" /> {monthLabel}
        </div>
        <button
          onClick={() => setMonthOffset((v) => v + 1)}
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-muted transition"
          aria-label="الشهر التالي"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {loadingCal ? (
        <Skeleton className="h-56 rounded-2xl" />
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-muted-foreground mb-1.5">
            {DAYS_SHORT.map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((cellDate, idx) => {
              const inMonth = cellDate.getMonth() === month;
              const weekday = cellDate.getDay();
              const sched = scheduleByWeekday.get(weekday);
              const dateKey = toDateKey(cellDate);
              const isDone = completedDates.has(dateKey);
              const isToday = dateKey === todayKey;

              return (
                <div
                  key={idx}
                  className={`rounded-xl p-1 text-center min-h-[52px] flex flex-col items-center justify-start gap-0.5 ${
                    inMonth ? "" : "opacity-30"
                  } ${isToday ? "ring-2 ring-primary" : ""}`}
                >
                  <div className="text-[10px] font-bold">{cellDate.getDate()}</div>
                  {sched && (
                    <div
                      className={`w-full text-[8.5px] leading-tight rounded-md px-1 py-0.5 truncate font-semibold ${
                        sched.isRest
                          ? "bg-muted text-muted-foreground"
                          : isDone
                          ? "bg-primary/20 text-primary line-through"
                          : "bg-secondary text-primary"
                      }`}
                    >
                      {sched.label}
                    </div>
                  )}
                  {isDone && !sched?.isRest && (
                    <CheckCircle2 className="w-3 h-3 text-primary" />
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-secondary" /> مجدول</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-primary/20" /> تم الإنجاز</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-muted" /> راحة</span>
          </div>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* الالتزام الأسبوعي: أيام تمرّنتِ فيها هالأسبوع + الستريك                */
/* ------------------------------------------------------------------ */

function WeeklyProgressCard({ completed, goal, streak }: { completed: number; goal: number; streak: number }) {
  const pct = goal > 0 ? Math.min(100, Math.round((completed / goal) * 100)) : 0;
  const size = 76;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;

  return (
    <Card className="p-4 rounded-2xl border-none shadow-soft flex flex-col items-center text-center">
      <div className="text-xs font-bold text-muted-foreground mb-2">التزامك هالأسبوع</div>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} stroke="hsl(var(--secondary))" strokeWidth={stroke} fill="none" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="hsl(var(--primary))"
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-base font-extrabold leading-none">
            {completed}/{goal || "—"}
          </span>
          <span className="text-[9px] text-muted-foreground mt-0.5">أيام</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 mt-3 text-sm font-bold text-orange-500">
        <Flame className="w-4 h-4" /> {streak} {streak === 1 ? "يوم متتالي" : "أيام متتالية"}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* مؤشراتك — بلغة واضحة مش أرقام مجردة                                  */
/* ------------------------------------------------------------------ */

function BodyStatsCard({ fp, weightLogs }: { fp: any; weightLogs: any[] }) {
  const bmi = fp?.bmi ?? null;
  const category = bmi ? bmiCategory(bmi) : null;

  const latest = weightLogs?.[0]?.weight ?? null;
  const prev = weightLogs?.[1]?.weight ?? null;
  const delta = latest != null && prev != null ? +(latest - prev).toFixed(1) : null;

  // بنحدد إذا الاتجاه "إيجابي" حسب هدفها
  const goal = (fp?.goal ?? "") as string;
  const wantsDown = goal.includes("lose");
  const wantsUp = goal.includes("gain") || goal.includes("muscle");

  let trendIcon = <Minus className="w-3.5 h-3.5" />;
  let trendClass = "text-muted-foreground";
  let trendText = "لا تغيير عن آخر قياس";
  if (delta != null && delta !== 0) {
    const goingDown = delta < 0;
    trendIcon = goingDown ? <TrendingDown className="w-3.5 h-3.5" /> : <TrendingUp className="w-3.5 h-3.5" />;
    const isGood = (goingDown && wantsDown) || (!goingDown && wantsUp);
    trendClass = isGood ? "text-emerald-500" : wantsDown || wantsUp ? "text-orange-500" : "text-muted-foreground";
    trendText = `${goingDown ? "نزل" : "زاد"} ${Math.abs(delta)} كغم عن آخر قياس`;
  }

  return (
    <Card className="p-4 rounded-2xl border-none shadow-soft flex flex-col justify-between">
      <div className="text-xs font-bold text-muted-foreground">مؤشر كتلة الجسم</div>

      {bmi ? (
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-extrabold">{bmi}</span>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-secondary text-primary">{category}</span>
        </div>
      ) : (
        <div className="mt-2 text-xs text-muted-foreground">أكملي ملفك الرياضي لحساب المؤشر</div>
      )}

      <div className="mt-3 pt-3 border-t border-border">
        {latest != null ? (
          <>
            <div className="text-[11px] text-muted-foreground">آخر وزن مسجّل</div>
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-sm font-bold">{latest} كغم</span>
              {delta != null && (
                <span className={`flex items-center gap-1 text-[11px] font-bold ${trendClass}`}>
                  {trendIcon} {trendText}
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="text-[11px] text-muted-foreground">سجّلي وزنك بملفك عشان تتابعي تقدمك بمرور الوقت</div>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* خطة التغذية - مصغّرة بمعلومات فعلية                                  */
/* ------------------------------------------------------------------ */

function NutritionSnippetCard({ plan, fp }: { plan: any; fp: any }) {
  // نحسب هدف بروتين اليوم بناءً على وزنها وهدفها (تضخيم يحتاج بروتين أكثر لبناء العضل،
  // وتنشيف/نزول وزن يحتاج بروتين أعلى كمان عشان تحافظي على العضل وقت العجز بالسعرات)
  const goal = (fp?.goal ?? "") as string;
  const isBulking = goal.includes("gain") || goal.includes("muscle") || goal.includes("bulk");
  const isCutting = goal.includes("lose");
  const proteinPerKg = isBulking ? 1.8 : isCutting ? 2.0 : 1.6;
  const proteinGrams = fp?.weight ? Math.round(fp.weight * proteinPerKg) : null;

  let subtitle: string;
  if (plan && proteinGrams) {
    subtitle = `${plan.min_calories}–${plan.max_calories} سعرة و~${proteinGrams} غ بروتين اليوم`;
  } else if (plan) {
    subtitle = `${plan.min_calories}–${plan.max_calories} سعرة حرارية مقترحة اليوم`;
  } else if (proteinGrams) {
    subtitle = `تحتاجي حوالي ${proteinGrams} غ بروتين اليوم بحسب هدفك — كمّلي خطة سعرات لتوصية أدق`;
  } else if (fp) {
    subtitle = "ما في خطة مخصّصة إلك بعد — استعرضي الخطط المتاحة";
  } else {
    subtitle = "أكملي ملفك الرياضي لتوصية مخصّصة إلك";
  }

  return (
    <Link to="/nutrition" className="block">
      <Card className="p-4 rounded-2xl border-none shadow-soft flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-secondary text-primary flex items-center justify-center shrink-0">
            <Apple className="w-5 h-5" />
          </div>
          <div>
            <div className="font-bold text-sm">{plan ? plan.name : "خطة التغذية"}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</div>
          </div>
        </div>
        <ChevronLeft className="w-4 h-4 text-muted-foreground shrink-0" />
      </Card>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* عنصر انتقال سريع (مدربات / شات)                                     */
/* ------------------------------------------------------------------ */

function QuickAction({ to, icon, title, badge }: { to: any; icon: React.ReactNode; title: string; badge?: number }) {
  return (
    <Link to={to}>
      <motion.div
        whileTap={{ scale: 0.97 }}
        className="relative flex items-center gap-3 p-4 rounded-2xl bg-card border border-border shadow-soft hover:border-primary/40 transition"
      >
        {!!badge && badge > 0 && (
          <div className="absolute -top-2 -left-2 min-w-[22px] h-[22px] px-1 rounded-full bg-destructive text-destructive-foreground text-[11px] font-extrabold flex items-center justify-center shadow-soft">
            {badge > 99 ? "99+" : badge}
          </div>
        )}
        <div className="w-10 h-10 rounded-xl bg-secondary text-primary flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="font-bold text-sm">{title}</div>
      </motion.div>
    </Link>
  );
}

/* ==================================================================== */
/* صفحة المدرّبة — تتضمن الآن قائمة كاملة بالمشتركات وتفاصيل كل واحدة     */
/* ==================================================================== */

type SubscriberInfo = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  goal: string | null;
  activity_level: string | null;
  weight: number | null;
  height: number | null;
  weeklyGoal: number;
  weeklyDone: number;
  hasActivePlan: boolean;
};

// بنحدد تقييم الأداء بشكل واضح ومحفّز بدل رقم مجرّد
function performanceMeta(sub: SubscriberInfo): { text: string; className: string } {
  if (!sub.hasActivePlan) {
    return { text: "لسا ما اعتمدت خطة تمرين", className: "text-muted-foreground bg-muted" };
  }
  if (sub.weeklyGoal <= 0) {
    return { text: "بلا هدف أسبوعي محدد", className: "text-muted-foreground bg-muted" };
  }
  const pct = sub.weeklyDone / sub.weeklyGoal;
  if (pct >= 1) return { text: "أداء ممتاز 🔥", className: "text-emerald-600 bg-emerald-500/10" };
  if (pct >= 0.5) return { text: "أداء جيد 👍", className: "text-primary bg-primary/10" };
  if (sub.weeklyDone > 0) return { text: "بحاجة لمتابعة أكثر", className: "text-orange-600 bg-orange-500/10" };
  return { text: "لم تتمرّن هالأسبوع بعد", className: "text-destructive bg-destructive/10" };
}

function TrainerHome({ userId, unreadCount }: { userId: string; unreadCount: number }) {
  const [subscribers, setSubscribers] = useState<SubscriberInfo[]>([]);
  const [postsCount, setPostsCount] = useState(0);
  const [loadingSubs, setLoadingSubs] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingSubs(true);

      const { count: p } = await supabase
        .from("posts")
        .select("*", { count: "exact", head: true })
        .eq("trainer_id", userId);
      setPostsCount(p ?? 0);

      // 1) قائمة المشتركات الفعّالات مع هذه المدربة
      const { data: subsRows } = await supabase
        .from("subscriptions")
        .select("user_id")
        .eq("trainer_id", userId)
        .eq("status", "active");

      const ids = (subsRows ?? []).map((s: any) => s.user_id as string);

      if (ids.length === 0) {
        setSubscribers([]);
        setLoadingSubs(false);
        return;
      }

      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setHours(0, 0, 0, 0);
      weekStart.setDate(now.getDate() - now.getDay());

      // 2) نجيب كل بيانات المشتركات دفعة وحدة (batched) بدل ما نستعلم لكل وحدة لحالها
      const [{ data: profs }, { data: fps }, { data: sels }, { data: logs }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, avatar_url").in("id", ids),
        fitnessProfileTable().select("*").in("user_id", ids),
        supabase.from("active_plan_selection").select("*").in("user_id", ids),
        supabase
          .from("workout_logs")
          .select("user_id, completed_at")
          .in("user_id", ids)
          .gte("completed_at", weekStart.toISOString()),
      ]);

      // 3) نجيب min_frequency لخطط التمارين النشطة عند المشتركات (عشان نعرف هدفهن الأسبوعي الحقيقي)
      const workoutIds = [...new Set((sels ?? []).filter((s: any) => s.workout_plan_id).map((s: any) => s.workout_plan_id))];
      const workoutsById = new Map<string, any>();
      if (workoutIds.length > 0) {
        const { data: ws } = await supabase.from("workouts").select("id, min_frequency").in("id", workoutIds);
        (ws ?? []).forEach((w: any) => workoutsById.set(w.id, w));
      }

      const profById = new Map<string, any>();
      (profs ?? []).forEach((p: any) => profById.set(p.id, p));
      const fpById = new Map<string, any>();
      (fps ?? []).forEach((f: any) => fpById.set(f.user_id, f));
      const selById = new Map<string, any>();
      (sels ?? []).forEach((s: any) => selById.set(s.user_id, s));

      // عدد الأيام (المختلفة) اللي تمرّنت فيها كل مشتركة هالأسبوع
      const logsByUser = new Map<string, Set<string>>();
      (logs ?? []).forEach((l: any) => {
        const dayKey = new Date(l.completed_at).toDateString();
        if (!logsByUser.has(l.user_id)) logsByUser.set(l.user_id, new Set());
        logsByUser.get(l.user_id)!.add(dayKey);
      });

      const list: SubscriberInfo[] = ids.map((uid) => {
        const prof = profById.get(uid);
        const fp = fpById.get(uid);
        const sel = selById.get(uid);
        const w = sel?.workout_plan_id ? workoutsById.get(sel.workout_plan_id) : null;
        const weeklyGoal = w?.min_frequency ?? fp?.frequency ?? 0;
        const weeklyDone = logsByUser.get(uid)?.size ?? 0;
        return {
          id: uid,
          full_name: prof?.full_name ?? null,
          avatar_url: prof?.avatar_url ?? null,
          goal: fp?.goal ?? null,
          activity_level: fp?.activity_level ?? null,
          weight: fp?.weight ?? null,
          height: fp?.height ?? null,
          weeklyGoal,
          weeklyDone,
          hasActivePlan: !!sel?.workout_plan_id,
        };
      });

      // نرتبهن: الأقل التزامًا فوق، عشان المدربة تنتبه أول شي للي محتاجات متابعة
      list.sort((a, b) => {
        const pctA = a.weeklyGoal > 0 ? a.weeklyDone / a.weeklyGoal : -1;
        const pctB = b.weeklyGoal > 0 ? b.weeklyDone / b.weeklyGoal : -1;
        return pctA - pctB;
      });

      setSubscribers(list);
      setLoadingSubs(false);
    })();
  }, [userId]);

  return (
    <>
      {/* بطاقة عدد المشتركات — بديل بطاقتي "مشتركات" و"منشورات" القديمتين */}
      <Card className="p-5 rounded-3xl gradient-primary text-primary-foreground border-none shadow-elegant relative overflow-hidden">
        <div className="absolute -top-8 -left-8 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
        <div className="relative flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 opacity-90 text-sm">
              <Users className="w-4 h-4" /> مشتركاتك حالياً
            </div>
            <div className="text-4xl font-extrabold mt-1">{loadingSubs ? "…" : subscribers.length}</div>
            <div className="text-xs opacity-90 mt-1">{postsCount} منشور نشرتيه لهلأ</div>
          </div>
          <div className="w-16 h-16 rounded-2xl bg-white/15 flex items-center justify-center">
            <Sparkles className="w-8 h-8" />
          </div>
        </div>
      </Card>

      {/* قائمة المشتركات بتفاصيلهن الكاملة */}
      <div>
        <h2 className="font-bold mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" /> تقدّم المشتركات
        </h2>

        {loadingSubs && (
          <div className="space-y-2">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
          </div>
        )}

        {!loadingSubs && subscribers.length === 0 && (
          <Card className="p-6 text-center rounded-2xl border-dashed">
            <Users className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">لا يوجد مشتركات بعد</p>
            <p className="text-xs text-muted-foreground mt-1">لما تشترك أي مستخدمة معك، رح تظهر تفاصيلها هون تلقائياً</p>
          </Card>
        )}

        <div className="space-y-2.5">
          {subscribers.map((sub) => {
            const isOpen = expandedId === sub.id;
            const perf = performanceMeta(sub);
            const pct = sub.weeklyGoal > 0 ? Math.min(100, Math.round((sub.weeklyDone / sub.weeklyGoal) * 100)) : 0;

            return (
              <Card key={sub.id} className="rounded-2xl overflow-hidden border-none shadow-soft">
                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : sub.id)}
                  className="w-full flex items-center gap-3 p-3.5 text-right"
                >
                  {sub.avatar_url ? (
                    <img src={sub.avatar_url} className="w-12 h-12 rounded-2xl object-cover shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-2xl gradient-primary text-primary-foreground flex items-center justify-center font-extrabold text-lg shrink-0">
                      {sub.full_name?.[0] ?? "؟"}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">{sub.full_name ?? "مستخدمة"}</div>
                    <div className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full mt-1 ${perf.className}`}>
                      {perf.text}
                    </div>
                  </div>

                  <div className="text-center shrink-0 px-2">
                    <div className="text-sm font-extrabold">
                      {sub.weeklyDone}/{sub.weeklyGoal || "—"}
                    </div>
                    <div className="text-[9px] text-muted-foreground">أيام هالأسبوع</div>
                  </div>

                  {isOpen ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-3.5 pb-4 pt-1 border-t border-border/60 space-y-3">
                        {/* شريط تقدّم أسبوعي */}
                        <div>
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                            <span>الالتزام الأسبوعي</span>
                            <span className="font-bold text-foreground">{pct}%</span>
                          </div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full gradient-primary transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>

                        {/* بيانات جسمانية وهدف */}
                        <div className="grid grid-cols-2 gap-2">
                          <StatChip
                            icon={<Target className="w-3.5 h-3.5" />}
                            label="الهدف"
                            value={sub.goal ? GOAL_LABELS[sub.goal as Goal] ?? sub.goal : "غير محدد"}
                          />
                          <StatChip
                            icon={<Activity className="w-3.5 h-3.5" />}
                            label="مستوى النشاط"
                            value={sub.activity_level ? ACTIVITY_LABELS[sub.activity_level as ActivityLevel] ?? sub.activity_level : "غير محدد"}
                          />
                          <StatChip
                            icon={<Weight className="w-3.5 h-3.5" />}
                            label="الوزن"
                            value={sub.weight != null ? `${sub.weight} كغم` : "—"}
                          />
                          <StatChip
                            icon={<Ruler className="w-3.5 h-3.5" />}
                            label="الطول"
                            value={sub.height != null ? `${sub.height} سم` : "—"}
                          />
                        </div>

                        {(!sub.goal || !sub.activity_level || sub.weight == null || sub.height == null) && (
                          <p className="text-[10px] text-muted-foreground text-center">
                            ما زالت لم تكمّل كل بيانات ملفها الرياضي بعد
                          </p>
                        )}

                        <Link
                          to="/chat"
                          className="flex items-center justify-center gap-1.5 text-xs font-bold text-primary bg-primary/10 rounded-xl py-2"
                        >
                          <MessageCircle className="w-3.5 h-3.5" /> راسليها
                        </Link>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            );
          })}
        </div>
      </div>

      <Link to="/chat" className="block">
        <Card className="p-5 rounded-2xl border-none shadow-soft flex items-center justify-between">
          <div>
            <div className="font-bold flex items-center gap-2">
              <MessageCircle className="w-4 h-4" /> الشات
            </div>
            <div className="text-sm text-muted-foreground mt-1">تابعي محادثاتك مع الأعضاء</div>
          </div>
          {unreadCount > 0 && (
            <div className="min-w-[26px] h-[26px] px-1.5 rounded-full bg-destructive text-destructive-foreground text-xs font-extrabold flex items-center justify-center shadow-soft">
              {unreadCount > 99 ? "99+" : unreadCount}
            </div>
          )}
        </Card>
      </Link>

      <Link to="/profile" className="block">
        <Card className="p-5 rounded-2xl border-none shadow-soft">
          <div className="font-bold">اذهبي إلى ملفك لإدارة المنشورات</div>
          <div className="text-sm text-muted-foreground mt-1">شاركي محتوى ملهم مع مشتركاتك</div>
        </Card>
      </Link>
    </>
  );
}

function StatChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 p-2.5 flex items-center gap-2">
      <span className="w-7 h-7 rounded-lg bg-background text-primary flex items-center justify-center shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="text-[9px] text-muted-foreground">{label}</div>
        <div className="text-[11px] font-bold truncate">{value}</div>
      </div>
    </div>
  );
}