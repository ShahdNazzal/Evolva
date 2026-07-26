import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Dumbbell, Apple, Plus, X, Trash2, Pencil, ImagePlus, Youtube, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { GOAL_LABELS, type Goal } from "@/lib/workout-rules";
import { uploadFile } from "@/lib/upload";

export const Route = createFileRoute("/_authenticated/_app/trainer-plans")({
  head: () => ({ meta: [{ title: "خططي كمدربة — EVOLVA" }] }),
  component: TrainerPlansPage,
});

const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

// خطة "أسبوع ثابت" هي نفس بنية خطط المستخدمة الشخصية بالضبط: مصفوفة من 7 عناصر، كل عنصر فيه day_of_week رقمي
function isFixedWeekPlan(plan: any): boolean {
  const days = Array.isArray(plan?.exercises) ? plan.exercises : [];
  return days.length === 7 && days.every((d: any) => d?.day_of_week != null);
}

function TrainerPlansPage() {
  const { user, role, loading } = useAuth();
  const [tab, setTab] = useState<"workout" | "nutrition">("workout");
  const [workouts, setWorkouts] = useState<any[]>([]);
  const [nutrition, setNutrition] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [openW, setOpenW] = useState(false);
  const [openN, setOpenN] = useState(false);
  const [editingWorkout, setEditingWorkout] = useState<any>(null);

  const load = async () => {
    if (!user) return;
    setLoadingData(true);
    const [{ data: w }, { data: n }] = await Promise.all([
      supabase.from("workouts").select("*").eq("trainer_id", user.id).order("created_at", { ascending: false }),
      supabase.from("nutrition_plans").select("*").eq("trainer_id", user.id).order("created_at", { ascending: false }),
    ]);
    setWorkouts(w ?? []);
    setNutrition(n ?? []);
    setLoadingData(false);
  };
  useEffect(() => { load(); }, [user]);

  if (loading) return <Skeleton className="h-40 rounded-3xl" />;
  if (role !== "trainer") {
    return (
      <Card className="p-8 text-center rounded-3xl">
        <Dumbbell className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
        <h2 className="font-bold mb-1">هذه الصفحة للمدربات فقط</h2>
        <p className="text-sm text-muted-foreground">إذا كنتِ مدربة، تواصلي مع الإدارة لتفعيل حسابك.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">خططي</h1>
        <Button
          onClick={() => {
            if (tab === "workout") {
              setEditingWorkout(null);
              setOpenW(true);
            } else {
              setOpenN(true);
            }
          }}
          className="rounded-xl gradient-primary"
        >
          <Plus className="w-4 h-4 ml-1" /> خطة جديدة
        </Button>
      </div>

      <div className="flex gap-2 p-1 bg-muted rounded-2xl">
        <button onClick={() => setTab("workout")} className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${tab === "workout" ? "bg-card shadow-soft" : "text-muted-foreground"}`}>
          تمارين ({workouts.length})
        </button>
        <button onClick={() => setTab("nutrition")} className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${tab === "nutrition" ? "bg-card shadow-soft" : "text-muted-foreground"}`}>
          تغذية ({nutrition.length})
        </button>
      </div>

      {loadingData && <Skeleton className="h-40 rounded-3xl" />}

      {!loadingData && tab === "workout" && (
        <div className="grid gap-2">
          {workouts.length === 0 && (
            <Card className="p-6 text-center rounded-2xl border-dashed">
              <Dumbbell className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">لا توجد خطط تمارين بعد</p>
            </Card>
          )}
          {workouts.map((w) => {
            const fixedWeek = isFixedWeekPlan(w);
            const daysCount = Array.isArray(w.exercises)
              ? fixedWeek
                ? w.exercises.filter((d: any) => !d.is_rest).length
                : w.exercises.length
              : 0;
            return (
              <Card key={w.id} className="p-4 rounded-2xl">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-3">
                    {w.image_url ? (
                      <img src={w.image_url} className="w-12 h-12 rounded-xl object-cover shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0"><Dumbbell className="w-5 h-5" /></div>
                    )}
                    <div className="min-w-0">
                      <div className="font-bold truncate">{w.name}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {daysCount} يوم تمرين • من {w.min_frequency} أيام/أسبوع
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => { setEditingWorkout(w); setOpenW(true); }}
                      className="p-2 text-muted-foreground hover:text-foreground"
                      title="تعديل الخطة"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm("حذف الخطة؟")) return;
                        await supabase.from("workouts").delete().eq("id", w.id);
                        toast.success("تم الحذف");
                        load();
                      }}
                      className="p-2 text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {!loadingData && tab === "nutrition" && (
        <div className="grid gap-2">
          {nutrition.length === 0 && (
            <Card className="p-6 text-center rounded-2xl border-dashed">
              <Apple className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">لا توجد خطط تغذية بعد</p>
            </Card>
          )}
          {nutrition.map((p) => (
            <Card key={p.id} className="p-4 rounded-2xl">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold">{p.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {GOAL_LABELS[p.goal as Goal]} • {p.min_calories}–{p.max_calories} سعرة
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {(Array.isArray(p.meals) ? p.meals : []).length} وجبات
                  </div>
                </div>
                <button
                  onClick={async () => {
                    if (!confirm("حذف الخطة؟")) return;
                    await supabase.from("nutrition_plans").delete().eq("id", p.id);
                    toast.success("تم الحذف");
                    load();
                  }}
                  className="p-2 text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <NewWorkoutDialog
        open={openW}
        onClose={() => { setOpenW(false); setEditingWorkout(null); }}
        trainerId={user?.id ?? ""}
        onSaved={load}
        editPlan={editingWorkout}
      />
      <NewNutritionDialog open={openN} onClose={() => setOpenN(false)} trainerId={user?.id ?? ""} onSaved={load} />
    </div>
  );
}

/* ==================================================================== */
/* خطة تمرين للمدربة — بنفس البنية بالضبط تبع خطط المستخدمة الشخصية        */
/* (أسبوع ثابت 7 أيام: day_of_week + is_rest + muscle_group + فيديو/شرح/نصيحة لكل تمرين) */
/* ==================================================================== */

type NewPlanExercise = { name: string; sets: number; reps: number; video_url: string; instruction: string; tips: string };
type NewPlanDay = { day_of_week: number; is_rest: boolean; muscle_group: string; items: NewPlanExercise[] };

function emptyExercise(): NewPlanExercise {
  return { name: "", sets: 3, reps: 12, video_url: "", instruction: "", tips: "" };
}

function defaultDays(): NewPlanDay[] {
  return DAYS.map((_, i) => ({ day_of_week: i, is_rest: true, muscle_group: "", items: [] }));
}

function NewWorkoutDialog({ open, onClose, trainerId, onSaved, editPlan }: any) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null);
  const [days, setDays] = useState<NewPlanDay[]>(defaultDays());
  const [saving, setSaving] = useState(false);

  // نفس مبدأ السحب والإفلات المستخدم بخطط المستخدمة الشخصية، مبني على Pointer Events عشان يشتغل بالموبايل واللابتوب معاً
  const [dragInfo, setDragInfo] = useState<{ dayIdx: number; exIdx: number } | null>(null);
  const [dragOverExIdx, setDragOverExIdx] = useState<number | null>(null);
  const itemRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());

  const registerItemRef = (dayIdx: number, exIdx: number) => (el: HTMLDivElement | null) => {
    const key = `${dayIdx}-${exIdx}`;
    if (el) itemRefsMap.current.set(key, el);
    else itemRefsMap.current.delete(key);
  };

  const editRef = useRef<any>(null);
  editRef.current = editPlan;

  useEffect(() => {
    if (!open) return;

    const ep = editRef.current;
    if (ep) {
      setName(ep.name || "");
      setDescription(ep.description || "");
      setImageFile(null);
      setExistingImageUrl(ep.image_url || null);

      const raw: any[] = Array.isArray(ep.exercises) ? [...ep.exercises] : [];

      if (raw.length === 7 && raw.every((d) => d.day_of_week != null)) {
        const sorted = raw.sort((a, b) => Number(a.day_of_week) - Number(b.day_of_week));
        setDays(
          sorted.map((d) => ({
            day_of_week: Number(d.day_of_week),
            is_rest: !!d.is_rest,
            muscle_group: d.muscle_group ?? "",
            items: Array.isArray(d.items)
              ? d.items.map((ex: any) => ({
                  name: ex.name ?? "",
                  sets: Number(ex.sets) || 3,
                  reps: Number(ex.reps) || 12,
                  video_url: ex.video_url ?? "",
                  instruction: ex.instruction ?? "",
                  tips: ex.tips ?? "",
                }))
              : [],
          }))
        );
      } else if (raw.length > 0) {
        // بنية قديمة (خطط أُنشئت قبل هالتحديث) — نحوّلها لأقرب شكل ممكن لأسبوع ثابت بدل ما نفقد بياناتها
        const converted = defaultDays();
        raw.slice(0, 7).forEach((d: any, i: number) => {
          converted[i] = {
            day_of_week: i,
            is_rest: !Array.isArray(d.items) || d.items.length === 0,
            muscle_group: d.name ?? "",
            items: Array.isArray(d.items)
              ? d.items.map((ex: any) => ({
                  name: ex.name ?? "",
                  sets: Number(ex.sets) || 3,
                  reps: Number(ex.reps) || 12,
                  video_url: ex.video_url ?? "",
                  instruction: ex.instruction ?? "",
                  tips: ex.tips ?? "",
                }))
              : [],
          };
        });
        setDays(converted);
      } else {
        setDays(defaultDays());
      }
    } else {
      setName("");
      setDescription("");
      setImageFile(null);
      setExistingImageUrl(null);
      setDays(defaultDays());
    }
  }, [open]);

  const updateDay = (idx: number, patch: Partial<NewPlanDay>) => {
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  const updateExercise = (dayIdx: number, exIdx: number, patch: Partial<NewPlanExercise>) => {
    setDays((prev) =>
      prev.map((d, i) => {
        if (i !== dayIdx) return d;
        const items = d.items.map((ex, j) => (j === exIdx ? { ...ex, ...patch } : ex));
        return { ...d, items };
      })
    );
  };

  const reorderExercise = (dayIdx: number, fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    setDays((prev) =>
      prev.map((d, i) => {
        if (i !== dayIdx) return d;
        const items = [...d.items];
        const [moved] = items.splice(fromIdx, 1);
        items.splice(toIdx, 0, moved);
        return { ...d, items };
      })
    );
  };

  const computeTargetIdx = (dayIdx: number, clientY: number, fallback: number) => {
    const entries = Array.from(itemRefsMap.current.entries())
      .filter(([key]) => key.startsWith(`${dayIdx}-`))
      .map(([key, el]) => ({ idx: Number(key.split("-")[1]), el }))
      .sort((a, b) => a.idx - b.idx);

    let targetIdx = fallback;
    for (const { idx, el } of entries) {
      const rect = el.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (clientY < mid) {
        targetIdx = idx;
        break;
      }
      targetIdx = idx;
    }
    return targetIdx;
  };

  const handleSave = async () => {
    if (!name.trim()) return toast.error("اكتبي اسم الخطة");

    const cleanedDays = days.map((d) => {
      const items = d.items
        .filter((ex) => ex.name?.trim())
        .map((ex) => ({
          name: ex.name.trim(),
          sets: ex.sets,
          reps: ex.reps,
          video_url: ex.video_url?.trim() || null,
          instruction: ex.instruction?.trim() || null,
          tips: ex.tips?.trim() || null,
        }));
      const isRest = d.is_rest || items.length === 0;
      const muscleGroup = !isRest ? d.muscle_group?.trim() || null : null;
      return {
        day_of_week: d.day_of_week,
        muscle_group: muscleGroup,
        is_rest: isRest,
        items: isRest ? [] : items,
      };
    });

    const hasAnyTraining = cleanedDays.some((d) => !d.is_rest);
    if (!hasAnyTraining) return toast.error("أضيفي تمريناً واحداً على الأقل بيوم واحد على الأقل");

    setSaving(true);
    try {
      let image_url = existingImageUrl;
      if (imageFile) {
        image_url = await uploadFile(imageFile, trainerId, "workouts");
      }

      const payload = {
        name,
        description: description || null,
        goal: "fitness" as const,
        activity_level: "moderate" as const,
        equipment: "gym" as const,
        min_frequency: cleanedDays.filter((d) => !d.is_rest).length,
        exercises: cleanedDays,
        is_public: true,
        image_url,
      };

      if (editRef.current) {
        const { error } = await supabase.from("workouts").update(payload).eq("id", editRef.current.id);
        if (error) throw error;
        toast.success("تم تحديث الخطة ✏️");
      } else {
        const { error } = await supabase.from("workouts").insert({ trainer_id: trainerId, ...payload });
        if (error) throw error;
        toast.success("تم نشر الخطة");
      }

      onClose();
      onSaved();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="rounded-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editRef.current ? "تعديل خطة التمرين" : "خطة تمرين جديدة"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {editRef.current && existingImageUrl && !imageFile && (
            <div className="relative rounded-xl overflow-hidden">
              <img src={existingImageUrl} className="w-full h-32 object-cover" />
              <div className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-lg">
                الصورة الحالية — اختاري صورة جديدة إذا بدك تغيّريها
              </div>
            </div>
          )}

          <div>
            <Label>اسم الخطة</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl mt-1" />
          </div>
          <div>
            <Label>وصف مختصر</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-xl mt-1" />
          </div>
          <div>
            <Label className="text-xs flex items-center gap-2"><ImagePlus className="w-4 h-4" /> صورة للخطة (اختياري)</Label>
            <Input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} className="rounded-xl mt-1" />
          </div>

          <div className="space-y-3">
            <Label>أيام الأسبوع</Label>
            {days.map((d, di) => (
              <Card key={di} className="p-3 rounded-2xl">
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <div className="font-bold text-sm">
                    {DAYS[d.day_of_week]}
                    {!d.is_rest && d.muscle_group?.trim() && (
                      <span className="text-primary"> - {d.muscle_group.trim()}</span>
                    )}
                  </div>
                  <label className="flex items-center gap-2 text-xs font-semibold shrink-0">
                    <input
                      type="checkbox"
                      checked={d.is_rest}
                      onChange={(e) => updateDay(di, { is_rest: e.target.checked, items: e.target.checked ? [] : d.items })}
                      className="w-4 h-4"
                    />
                    يوم راحة
                  </label>
                </div>

                {!d.is_rest && (
                  <div className="space-y-2">
                    <Input
                      value={d.muscle_group}
                      onChange={(e) => updateDay(di, { muscle_group: e.target.value })}
                      placeholder="اسم العضلة أو التمرين لهاليوم (مثلاً: قلوتس، أرجل، صدر، ظهر)"
                      className="rounded-xl h-9"
                    />

                    {d.items.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">ما في تمارين بعد لهاد اليوم</p>
                    )}
                    {d.items.length > 1 && (
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <GripVertical className="w-3 h-3" /> اسحبي التمارين من المقبض لتغيير ترتيبها
                      </p>
                    )}
                    {d.items.map((ex, ei) => {
                      const isDragging = dragInfo?.dayIdx === di && dragInfo?.exIdx === ei;
                      const isDragOverTarget =
                        dragInfo?.dayIdx === di && dragInfo?.exIdx !== ei && dragOverExIdx === ei;
                      return (
                        <div
                          key={ei}
                          ref={registerItemRef(di, ei)}
                          className={`rounded-xl border p-2 space-y-2 bg-background transition-colors ${
                            isDragging ? "opacity-40" : ""
                          } ${isDragOverTarget ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className="p-2 -m-2 shrink-0 text-muted-foreground cursor-grab active:cursor-grabbing"
                              style={{ touchAction: "none" }}
                              title="اسحبي لتغيير الترتيب"
                              onPointerDown={(e) => {
                                e.preventDefault();
                                e.currentTarget.setPointerCapture(e.pointerId);
                                setDragInfo({ dayIdx: di, exIdx: ei });
                                setDragOverExIdx(ei);
                              }}
                              onPointerMove={(e) => {
                                if (!dragInfo || dragInfo.dayIdx !== di) return;
                                const target = computeTargetIdx(di, e.clientY, dragOverExIdx ?? ei);
                                setDragOverExIdx(target);
                              }}
                              onPointerUp={() => {
                                if (dragInfo && dragOverExIdx !== null && dragOverExIdx !== dragInfo.exIdx) {
                                  reorderExercise(dragInfo.dayIdx, dragInfo.exIdx, dragOverExIdx);
                                }
                                setDragInfo(null);
                                setDragOverExIdx(null);
                              }}
                              onPointerCancel={() => {
                                setDragInfo(null);
                                setDragOverExIdx(null);
                              }}
                            >
                              <GripVertical className="w-4 h-4" />
                            </span>
                            <Input
                              value={ex.name}
                              onChange={(e) => updateExercise(di, ei, { name: e.target.value })}
                              placeholder="اسم التمرين"
                              className="rounded-xl h-9 flex-1"
                            />
                            <button
                              onClick={() => updateDay(di, { items: d.items.filter((_, j) => j !== ei) })}
                              className="p-2 shrink-0 text-muted-foreground hover:text-destructive"
                              title="حذف التمرين"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-[10px] text-muted-foreground">مجموعات</Label>
                              <Input
                                type="number"
                                value={ex.sets}
                                onChange={(e) => updateExercise(di, ei, { sets: +e.target.value })}
                                className="rounded-xl h-9 text-center mt-1"
                              />
                            </div>
                            <div>
                              <Label className="text-[10px] text-muted-foreground">تكرارات</Label>
                              <Input
                                type="number"
                                value={ex.reps}
                                onChange={(e) => updateExercise(di, ei, { reps: +e.target.value })}
                                className="rounded-xl h-9 text-center mt-1"
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Youtube className="w-4 h-4 text-muted-foreground shrink-0" />
                            <Input
                              value={ex.video_url}
                              onChange={(e) => updateExercise(di, ei, { video_url: e.target.value })}
                              placeholder="رابط فيديو يوتيوب (اختياري)"
                              className="rounded-xl h-8 text-xs"
                            />
                          </div>
                          <Input
                            value={ex.instruction}
                            onChange={(e) => updateExercise(di, ei, { instruction: e.target.value })}
                            placeholder="شرح طريقة الأداء (اختياري)"
                            className="rounded-xl h-8 text-xs"
                          />
                          <Input
                            value={ex.tips}
                            onChange={(e) => updateExercise(di, ei, { tips: e.target.value })}
                            placeholder="نصيحة سريعة (اختياري)"
                            className="rounded-xl h-8 text-xs"
                          />
                        </div>
                      );
                    })}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateDay(di, { items: [...d.items, emptyExercise()] })}
                      className="rounded-xl w-full"
                    >
                      <Plus className="w-4 h-4 ml-1" /> إضافة تمرين
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>

          <Button disabled={saving} onClick={handleSave} className="w-full rounded-2xl gradient-primary">
            {saving ? "جاري الحفظ..." : editRef.current ? "تحديث الخطة" : "نشر الخطة"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewNutritionDialog({ open, onClose, trainerId, onSaved }: any) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [goal, setGoal] = useState<Goal>("fitness");
  const [minCal, setMinCal] = useState(1400);
  const [maxCal, setMaxCal] = useState(1800);
  const [meals, setMeals] = useState<any[]>([{ meal: "فطور", name: "", calories: 0 }]);

  const reset = () => {
    setName(""); setDescription(""); setGoal("fitness");
    setMinCal(1400); setMaxCal(1800);
    setMeals([{ meal: "فطور", name: "", calories: 0 }]);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="rounded-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>خطة تغذية جديدة</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>اسم الخطة</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl mt-1" />
          </div>
          <div>
            <Label>وصف مختصر</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-xl mt-1" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label>الهدف</Label>
              <select value={goal} onChange={(e) => setGoal(e.target.value as Goal)} className="w-full mt-1 h-10 rounded-xl border border-input bg-background px-2 text-sm">
                {(Object.keys(GOAL_LABELS) as Goal[]).map((g) => <option key={g} value={g}>{GOAL_LABELS[g]}</option>)}
              </select>
            </div>
            <div>
              <Label>سعرات من</Label>
              <Input type="number" value={minCal} onChange={(e) => setMinCal(+e.target.value)} className="rounded-xl mt-1" />
            </div>
            <div>
              <Label>إلى</Label>
              <Input type="number" value={maxCal} onChange={(e) => setMaxCal(+e.target.value)} className="rounded-xl mt-1" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>الوجبات</Label>
            {meals.map((m, i) => (
              <div key={i} className="grid grid-cols-[80px_1fr_70px_auto] gap-2 items-center">
                <Input value={m.meal} onChange={(e) => { const c = [...meals]; c[i].meal = e.target.value; setMeals(c); }} className="rounded-xl h-9" placeholder="نوع" />
                <Input value={m.name} onChange={(e) => { const c = [...meals]; c[i].name = e.target.value; setMeals(c); }} className="rounded-xl h-9" placeholder="الوجبة" />
                <Input type="number" value={m.calories} onChange={(e) => { const c = [...meals]; c[i].calories = +e.target.value; setMeals(c); }} className="rounded-xl h-9 text-center" />
                <button onClick={() => setMeals(meals.filter((_, j) => j !== i))}><X className="w-4 h-4" /></button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setMeals([...meals, { meal: "سناك", name: "", calories: 0 }])} className="rounded-xl w-full">
              <Plus className="w-4 h-4 ml-1" /> إضافة وجبة
            </Button>
          </div>

          <Button
            onClick={async () => {
              if (!name.trim()) return toast.error("اكتبي اسم الخطة");
              const cleaned = meals.filter((m) => m.name?.trim());
              if (cleaned.length === 0) return toast.error("أضيفي وجبة واحدة على الأقل");
              if (minCal > maxCal) return toast.error("نطاق السعرات غير صحيح");
              const { error } = await supabase.from("nutrition_plans").insert({
                trainer_id: trainerId,
                name, description: description || null,
                goal, min_calories: minCal, max_calories: maxCal,
                meals: cleaned,
              });
              if (error) return toast.error(error.message);
              toast.success("تم النشر");
              reset(); onClose(); onSaved();
            }}
            className="w-full rounded-2xl gradient-primary"
          >
            نشر الخطة
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}