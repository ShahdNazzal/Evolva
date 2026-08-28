//C:\Users\lenovo\Downloads\jammawia-main (1)\jammawia-main\src\routes\onboarding.tsx
import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  matchWorkoutPlan,
  calcBMI,
  GOAL_LABELS,
  ACTIVITY_LABELS,
  EQUIPMENT_LABELS,
  type Goal,
  type ActivityLevel,
  type Equipment,
} from "@/lib/workout-rules";
import { calcCalories, matchNutritionPlan } from "@/lib/nutrition-rules";
import { User as UserIcon, Dumbbell, ChevronLeft, ChevronRight, Check } from "lucide-react";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: OnboardingPage,
});

type Step = "role" | "trainer-info" | "basics" | "goal" | "activity" | "equipment" | "injuries" | "done";

function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("role");
  const [loading, setLoading] = useState(false);

  // Role
  const [role, setRole] = useState<"user" | "trainer" | null>(null);
  // Trainer
  const [specialization, setSpecialization] = useState("");
  const [experience, setExperience] = useState(1);
  const [bio, setBio] = useState("");
  // User onboarding
  const [height, setHeight] = useState(165);
  const [weight, setWeight] = useState(60);
  const [age, setAge] = useState(25);
  const [goal, setGoal] = useState<Goal>("fitness");
  const [activity, setActivity] = useState<ActivityLevel>("light");
  const [equipment, setEquipment] = useState<Equipment>("home");
  const [frequency, setFrequency] = useState(3);
  const [injuries, setInjuries] = useState("");

  // If already onboarded, skip
  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data: r } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id).maybeSingle();
      if (r?.role === "trainer") {
        const { data: t } = await supabase.from("trainer_profiles").select("user_id").eq("user_id", u.user.id).maybeSingle();
        if (t) navigate({ to: "/home" });
      } else if (r?.role === "user") {
        const { data: fp } = await supabase.from("user_fitness_profile").select("user_id").eq("user_id", u.user.id).maybeSingle();
        if (fp) navigate({ to: "/home" });
      }
    })();
  }, [navigate]);

  async function saveRole() {
    if (!role) return;
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { setLoading(false); return; }
    // Check if role already exists (idempotent)
    const { data: existing } = await supabase
      .from("user_roles").select("role").eq("user_id", u.user.id).maybeSingle();
    if (!existing) {
      const { error } = await supabase.rpc("assign_initial_role", { _role: role });
      if (error) {
        setLoading(false);
        toast.error("تعذّر حفظ الدور: " + error.message);
        return;
      }
    }
    setLoading(false);
    setStep(role === "trainer" ? "trainer-info" : "basics");
  }

  async function saveTrainer() {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("trainer_profiles").insert({
      user_id: u.user.id,
      specialization,
      experience_years: experience,
      bio,
    });
    setLoading(false);
    if (error) return toast.error("خطأ: " + error.message);
    toast.success("تم إنشاء ملفك كمدربة");
    navigate({ to: "/home" });
  }

  async function finishUser() {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const bmi = calcBMI(height, weight);
    const { error } = await supabase.from("user_fitness_profile").upsert({
      user_id: u.user.id,
      height,
      weight,
      age,
      goal,
      activity_level: activity,
      equipment,
      frequency,
      injuries: injuries || null,
      bmi,
    });
    if (error) {
      setLoading(false);
      return toast.error(error.message);
    }
    // Rule-based matching
    const workout = await matchWorkoutPlan({ goal, activity_level: activity, equipment, frequency });
    const calories = calcCalories({ weightKg: weight, heightCm: height, age, activity, goal });
    const nutrition = await matchNutritionPlan(goal, calories);
    if (workout && nutrition) {
      await supabase.from("active_plan_selection").upsert({
        user_id: u.user.id,
        workout_plan_type: "trainer",
        workout_plan_id: workout.id,
        nutrition_plan_type: "trainer",
        nutrition_plan_id: nutrition.id,
      });
    }
    setLoading(false);
    toast.success("تم! خطتك جاهزة");
    navigate({ to: "/home" });
  }

  const stepIndex = ["role", "basics", "goal", "activity", "equipment", "injuries"].indexOf(step);
  const totalSteps = 6;
  const progress = role === "user" && stepIndex >= 0 ? ((stepIndex + 1) / totalSteps) * 100 : 0;

  return (
    <div className="min-h-screen gradient-blush px-4 py-8 flex items-center">
      <div className="max-w-lg mx-auto w-full">
        {role === "user" && (
          <div className="mb-6">
            <div className="flex justify-between text-xs text-muted-foreground mb-2">
              <span>الخطوة {Math.max(stepIndex, 0) + 1} من {totalSteps}</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <motion.div
                className="h-full gradient-primary"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.25 }}
            className="glass rounded-3xl p-6 md:p-8 shadow-elegant"
          >
            {step === "role" && (
              <div>
                <h2 className="text-2xl font-bold mb-2">أهلاً بكِ في EVOLVA</h2>
                <p className="text-muted-foreground mb-6 text-sm">اختاري نوع حسابك</p>
                <div className="grid gap-3">
                  <RoleCard
                    active={role === "user"}
                    onClick={() => setRole("user")}
                    icon={<UserIcon className="w-6 h-6" />}
                    title="مستخدمة"
                    desc="متابعة التمارين والتغذية والاشتراك مع مدربات"
                  />
                  <RoleCard
                    active={role === "trainer"}
                    onClick={() => setRole("trainer")}
                    icon={<Dumbbell className="w-6 h-6" />}
                    title="مدربة معتمدة"
                    desc="إنشاء ملف تدريبي والتواصل مع المشتركات"
                  />
                </div>
                <Button
                  onClick={saveRole}
                  disabled={!role || loading}
                  className="w-full h-12 rounded-2xl gradient-primary mt-6 font-semibold"
                >
                  متابعة
                </Button>
              </div>
            )}

            {step === "trainer-info" && (
              <div>
                <h2 className="text-2xl font-bold mb-4">ملف المدربة</h2>
                <div className="space-y-4">
                  <div>
                    <Label>التخصص</Label>
                    <Input value={specialization} onChange={(e) => setSpecialization(e.target.value)} placeholder="مثال: لياقة عامة، تنحيف، يوغا" className="mt-1.5 rounded-xl" />
                  </div>
                  <div>
                    <Label>سنوات الخبرة</Label>
                    <Input type="number" min={0} value={experience} onChange={(e) => setExperience(+e.target.value)} className="mt-1.5 rounded-xl" />
                  </div>
                  <div>
                    <Label>نبذة عنكِ</Label>
                    <textarea
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      className="mt-1.5 w-full min-h-24 rounded-xl border border-input bg-background p-3 text-sm"
                      placeholder="اكتبي تعريفاً موجزاً..."
                    />
                  </div>
                </div>
                <Button onClick={saveTrainer} disabled={!specialization || loading} className="w-full h-12 rounded-2xl gradient-primary mt-6 font-semibold">
                  إنشاء الملف
                </Button>
              </div>
            )}

            {step === "basics" && (
              <div>
                <h2 className="text-2xl font-bold mb-4">معلوماتك الأساسية</h2>
                <div className="space-y-4">
                  <NumberField label="الطول (سم)" value={height} onChange={setHeight} min={100} max={220} />
                  <NumberField label="الوزن (كغ)" value={weight} onChange={setWeight} min={30} max={200} />
                  <NumberField label="العمر" value={age} onChange={setAge} min={13} max={90} />
                </div>
                <StepNav onNext={() => setStep("goal")} />
              </div>
            )}

            {step === "goal" && (
              <div>
                <h2 className="text-2xl font-bold mb-4">ما هو هدفك؟</h2>
                <div className="grid grid-cols-2 gap-3">
                  {(Object.keys(GOAL_LABELS) as Goal[]).map((g) => (
                    <OptionCard key={g} active={goal === g} onClick={() => setGoal(g)} label={GOAL_LABELS[g]} />
                  ))}
                </div>
                <StepNav onBack={() => setStep("basics")} onNext={() => setStep("activity")} />
              </div>
            )}

            {step === "activity" && (
              <div>
                <h2 className="text-2xl font-bold mb-4">مستوى نشاطك</h2>
                <div className="grid gap-2">
                  {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((a) => (
                    <OptionCard key={a} active={activity === a} onClick={() => setActivity(a)} label={ACTIVITY_LABELS[a]} />
                  ))}
                </div>
                <div className="mt-4">
                  <Label>عدد أيام التمرين أسبوعياً</Label>
                  <div className="grid grid-cols-5 gap-2 mt-2">
                    {[2, 3, 4, 5, 6].map((n) => (
                      <button
                        key={n}
                        onClick={() => setFrequency(n)}
                        className={`h-12 rounded-xl font-semibold transition ${
                          frequency === n ? "gradient-primary text-primary-foreground" : "bg-muted"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <StepNav onBack={() => setStep("goal")} onNext={() => setStep("equipment")} />
              </div>
            )}

            {step === "equipment" && (
              <div>
                <h2 className="text-2xl font-bold mb-4">المعدات المتوفرة</h2>
                <div className="grid gap-2">
                  {(Object.keys(EQUIPMENT_LABELS) as Equipment[]).map((e) => (
                    <OptionCard key={e} active={equipment === e} onClick={() => setEquipment(e)} label={EQUIPMENT_LABELS[e]} />
                  ))}
                </div>
                <StepNav onBack={() => setStep("activity")} onNext={() => setStep("injuries")} />
              </div>
            )}

            {step === "injuries" && (
              <div>
                <h2 className="text-2xl font-bold mb-2">إصابات أو محدوديات؟</h2>
                <p className="text-sm text-muted-foreground mb-4">اختياري — يساعدنا لاستبعاد تمارين غير مناسبة</p>
                <textarea
                  value={injuries}
                  onChange={(e) => setInjuries(e.target.value)}
                  className="w-full min-h-24 rounded-xl border border-input bg-background p-3 text-sm"
                  placeholder="مثال: ألم في الركبة، مشاكل في الظهر..."
                />
                <div className="flex gap-2 mt-6">
                  <Button variant="outline" onClick={() => setStep("equipment")} className="rounded-2xl">
                    <ChevronRight className="w-4 h-4 ml-1" /> رجوع
                  </Button>
                  <Button onClick={finishUser} disabled={loading} className="flex-1 h-12 rounded-2xl gradient-primary font-semibold">
                    {loading ? "جاري إعداد خطتك..." : "إنهاء وإنشاء خطتي"} <Check className="w-4 h-4 mr-1" />
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function RoleCard({ active, onClick, icon, title, desc }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <button
      onClick={onClick}
      className={`text-right p-5 rounded-2xl border-2 transition-all ${
        active ? "border-primary bg-primary/5 shadow-soft" : "border-border bg-card hover:border-primary/40"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${active ? "gradient-primary text-primary-foreground" : "bg-muted"}`}>
          {icon}
        </div>
        <div className="flex-1">
          <div className="font-bold text-lg">{title}</div>
          <div className="text-sm text-muted-foreground mt-1">{desc}</div>
        </div>
      </div>
    </button>
  );
}

function OptionCard({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`p-4 rounded-2xl border-2 font-semibold text-sm transition ${
        active ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"
      }`}
    >
      {label}
    </button>
  );
}

function NumberField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-2 mt-1.5">
        <button onClick={() => onChange(Math.max(min, value - 1))} className="w-11 h-11 rounded-xl bg-muted font-bold text-lg">−</button>
        <Input type="number" value={value} onChange={(e) => onChange(+e.target.value)} className="text-center rounded-xl font-bold text-lg" min={min} max={max} />
        <button onClick={() => onChange(Math.min(max, value + 1))} className="w-11 h-11 rounded-xl bg-muted font-bold text-lg">+</button>
      </div>
    </div>
  );
}

function StepNav({ onBack, onNext }: { onBack?: () => void; onNext: () => void }) {
  return (
    <div className="flex gap-2 mt-6">
      {onBack && (
        <Button variant="outline" onClick={onBack} className="rounded-2xl">
          <ChevronRight className="w-4 h-4 ml-1" /> رجوع
        </Button>
      )}
      <Button onClick={onNext} className="flex-1 h-12 rounded-2xl gradient-primary font-semibold">
        متابعة <ChevronLeft className="w-4 h-4 mr-1" />
      </Button>
    </div>
  );
}
