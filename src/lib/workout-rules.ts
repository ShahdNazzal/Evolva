//C:\Users\lenovo\Downloads\jammawia-main (1)\jammawia-main\src\lib\workout-rules.ts

import { supabase } from "@/integrations/supabase/client";

export type Goal = "lose_weight" | "gain_muscle" | "fitness" | "tone";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "high";
export type Equipment = "home" | "gym" | "none";

export interface FitnessInput {
  goal: Goal;
  activity_level: ActivityLevel;
  equipment: Equipment;
  frequency: number;
}

/**
 * Strict workout matcher.
 *
 * القاعدة: خطة الكوتش لازم تطابق goal + activity_level + equipment تبع
 * المستخدمة بالضبط الثلاثة مع بعض (بغض النظر مين الكوتشة الي نشرتها).
 * ما في "أقرب حل" ولا نقاط تقريبية — إذا ما في خطة منشورة (is_public)
 * مطابقة تماماً على الثلاثة، بترجع null وما بينحط أي تمرين تلقائي،
 * وبتضل المستخدمة تعتمد خطة بنفسها من صفحة التمارين (SwitchDialog).
 *
 * frequency وحدها منستخدمها كـ tie-breaker بس (مش شرط تطابق تام)، لأنه
 * منطقياً خطة تتطلب أيام أقل أو تساوي اللي المستخدمة قادرة تلتزم فيها
 * بتضل قابلة للتطبيق، وما لازم نستبعدها بسبب هيك فرق بسيط.
 */
export async function matchWorkoutPlan(input: FitnessInput) {
  const { data: candidates, error } = await supabase
    .from("workouts")
    .select("*")
    .eq("is_public", true)
    .eq("goal", input.goal)
    .eq("activity_level", input.activity_level)
    .eq("equipment", input.equipment)
    .not("trainer_id", "is", null); // بس خطط الكوتشات المنشورة، مش الخطط الشخصية لمستخدمات تانيات

  if (error) throw error;
  if (!candidates || candidates.length === 0) return null;

  // من بين الخطط المتطابقة تماماً بالثلاثة، منفضّل يلي min_frequency تبعها
  // ما بتتطلب من المستخدمة أيام تدريب أكتر مما اختارت، وأقرب عدد أيام لطلبها.
  const feasible = candidates.filter((w) => w.min_frequency <= input.frequency);
  const pool = feasible.length > 0 ? feasible : candidates;
  pool.sort((a, b) => b.min_frequency - a.min_frequency);

  return pool[0];
}

export function calcBMI(heightCm: number, weightKg: number) {
  const h = heightCm / 100;
  return +(weightKg / (h * h)).toFixed(1);
}

export function bmiCategory(bmi: number): string {
  if (bmi < 18.5) return "نحافة";
  if (bmi < 25) return "وزن طبيعي";
  if (bmi < 30) return "زيادة وزن";
  return "سمنة";
}

export const GOAL_LABELS: Record<Goal, string> = {
  lose_weight: "تنحيف",
  gain_muscle: "تضخيم",
  fitness: "لياقة عامة",
  tone: "شد الجسم",
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: "خامل",
  light: "نشاط خفيف",
  moderate: "نشاط متوسط",
  high: "نشاط عالي",
};

export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  home: "معدات منزلية",
  gym: "نادي رياضي",
  none: "بدون معدات",
};