import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Heart,
  MessageCircle,
  Grid3x3,
  Rows3,
  Dumbbell,
  Apple,
  UserPlus,
  UserCheck,
  Sparkles,
  Send,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/_app/trainer/$id")({
  head: () => ({ meta: [{ title: "المدربة — EVOLVA" }] }),
  component: TrainerProfile,
});

function TrainerProfile() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [trainer, setTrainer] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [workouts, setWorkouts] = useState<any[]>([]);
  const [nutrition, setNutrition] = useState<any[]>([]);
  const [tab, setTab] = useState<"posts" | "workouts" | "nutrition">("posts");
  const [view, setView] = useState<"grid" | "feed">("feed");
  const [following, setFollowing] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [likes, setLikes] = useState<Set<string>>(new Set());

  const load = async () => {
    const [{ data: t }, { data: p }, { data: ps }, { data: ws }, { data: ns }] = await Promise.all([
      supabase.from("trainer_profiles").select("*").eq("user_id", id).maybeSingle(),
      supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
      supabase.from("posts").select("*").eq("author_id", id).order("created_at", { ascending: false }),
      supabase.from("workouts").select("*").eq("trainer_id", id).order("created_at", { ascending: false }),
      supabase.from("nutrition_plans").select("*").eq("trainer_id", id).order("created_at", { ascending: false }),
    ]);
    setTrainer(t); setProfile(p); setPosts(ps ?? []); setWorkouts(ws ?? []); setNutrition(ns ?? []);
    if (user) {
      const { data: fav } = await supabase.from("trainer_favorites").select("trainer_id").eq("user_id", user.id).eq("trainer_id", id).maybeSingle();
      setFollowing(!!fav);

      const { data: sub } = await supabase
        .from("subscriptions")
        .select("status")
        .eq("user_id", user.id)
        .eq("trainer_id", id)
        .maybeSingle();
      setSubscribed(!!sub && sub.status === "active");

      const { data: ls } = await supabase.from("post_likes").select("post_id").eq("user_id", user.id);
      setLikes(new Set((ls ?? []).map((x) => x.post_id)));
    }
  };
  useEffect(() => { load(); }, [id, user]);

  const toggleFollow = async () => {
    if (!user) return;
    if (following) {
      await supabase.from("trainer_favorites").delete().eq("user_id", user.id).eq("trainer_id", id);
      setFollowing(false);
    } else {
      await supabase.from("trainer_favorites").insert({ user_id: user.id, trainer_id: id });
      toast.success("تمت المتابعة 💖");
      setFollowing(true);
    }
  };

  // الاشتراك مع المدربة: مبني على جدول subscriptions، وممكن للمستخدمة تشترك عند أكثر من مدربة بنفس الوقت
  const toggleSubscribe = async () => {
    if (!user || subscribing) return;
    setSubscribing(true);
    try {
      if (subscribed) {
        const { error } = await supabase
          .from("subscriptions")
          .update({ status: "cancelled" })
          .eq("user_id", user.id)
          .eq("trainer_id", id);
        if (error) throw error;
        setSubscribed(false);
        toast.success("تم إلغاء الاشتراك مع هذه المدربة");
      } else {
        // upsert عشان قيد unique(user_id, trainer_id) — لو سبق واشتركت وألغت، هيك بترجع تفعّل نفس الصف
        const { error } = await supabase
          .from("subscriptions")
          .upsert({ user_id: user.id, trainer_id: id, status: "active" }, { onConflict: "user_id,trainer_id" });
        if (error) throw error;
        setSubscribed(true);
        toast.success("تم الاشتراك مع المدربة 🎉");
      }
    } catch (err: any) {
      toast.error(err.message ?? "صار في خطأ، حاولي مرة ثانية");
    } finally {
      setSubscribing(false);
    }
  };

  const toggleLike = async (postId: string) => {
    if (!user) return;
    if (likes.has(postId)) {
      await supabase.from("post_likes").delete().eq("post_id", postId).eq("user_id", user.id);
      const s = new Set(likes); s.delete(postId); setLikes(s);
    } else {
      await supabase.from("post_likes").insert({ post_id: postId, user_id: user.id });
      setLikes(new Set([...likes, postId]));
    }
  };

  const adoptWorkout = async (workoutId: string) => {
    if (!user) return;
    const { data: cur } = await supabase.from("active_plan_selection").select("*").eq("user_id", user.id).maybeSingle();
    await supabase.from("active_plan_selection").upsert({
      user_id: user.id,
      workout_plan_type: "trainer",
      workout_plan_id: workoutId,
      nutrition_plan_type: cur?.nutrition_plan_type,
      nutrition_plan_id: cur?.nutrition_plan_id,
    });
    toast.success("تم اعتماد الخطة");
  };

  const adoptNutrition = async (nId: string) => {
    if (!user) return;
    const { data: cur } = await supabase.from("active_plan_selection").select("*").eq("user_id", user.id).maybeSingle();
    await supabase.from("active_plan_selection").upsert({
      user_id: user.id,
      workout_plan_type: cur?.workout_plan_type,
      workout_plan_id: cur?.workout_plan_id,
      nutrition_plan_type: "trainer",
      nutrition_plan_id: nId,
    });
    toast.success("تم اعتماد خطة التغذية");
  };

  return (
    <div className="space-y-4">

      <Card className="p-6 rounded-3xl gradient-blush border-none">
        <div className="flex items-center gap-4">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} className="w-20 h-20 rounded-3xl object-cover shrink-0" />
          ) : (
            <div className="w-20 h-20 rounded-3xl gradient-primary text-primary-foreground flex items-center justify-center text-3xl font-extrabold shrink-0">
              {profile?.full_name?.[0]}
            </div>
          )}
          {/* min-w-0 + truncate عشان الاسم/التخصص الطويل ما يكسر التصميم عالموبايل */}
          <div className="flex-1 min-w-0">
            <div className="font-extrabold text-xl truncate">{profile?.full_name}</div>
            <div className="text-xs text-primary font-semibold truncate">{trainer?.specialization}</div>
            <div className="text-xs text-muted-foreground mt-1">{trainer?.experience_years} سنوات خبرة</div>
          </div>
        </div>
        {trainer?.bio && <p className="text-sm mt-4 leading-relaxed">{trainer.bio}</p>}

        {user?.id !== id && (
          <div className="mt-4 space-y-2">
            {/* زر الاشتراك — العنصر الأبرز بالكارد، وفيه للمستخدمة تشترك عند أكثر من مدربة بنفس الوقت */}
            <Button
              onClick={toggleSubscribe}
              disabled={subscribing}
              className={`w-full rounded-2xl font-extrabold ${subscribed ? "" : "gradient-primary"}`}
              variant={subscribed ? "outline" : "default"}
            >
              {subscribed ? (
                <><UserCheck className="w-4 h-4 ml-1.5" /> مشتركة مع {profile?.full_name ?? "المدربة"} ✓</>
              ) : (
                <><Sparkles className="w-4 h-4 ml-1.5" /> الاشتراك مع {profile?.full_name ?? "الكوتش"}</>
              )}
            </Button>

            <div className="grid grid-cols-2 gap-2">
              <Button onClick={toggleFollow} variant={following ? "outline" : "secondary"} className="rounded-2xl">
                {following ? <><UserCheck className="w-4 h-4 ml-1" /> متابَعة</> : <><UserPlus className="w-4 h-4 ml-1" /> متابعة</>}
              </Button>
              {/* بدل ما نودّي على قائمة الشات، منروح مباشرة عالمحادثة مع هالمدربة */}
              <Button
                onClick={() => navigate({ to: "/chat", search: { with: id } })}
                variant="outline"
                className="rounded-2xl"
              >
                <MessageCircle className="w-4 h-4 ml-1" /> رسالة
              </Button>
            </div>
          </div>
        )}
      </Card>

      <div className="flex gap-2 p-1 bg-muted rounded-2xl">
        {(["posts", "workouts", "nutrition"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={`flex-1 py-2 rounded-xl text-[11px] sm:text-xs font-semibold transition truncate px-1 ${tab === k ? "bg-card shadow-soft" : "text-muted-foreground"}`}>
            {k === "posts" ? `منشورات (${posts.length})` : k === "workouts" ? `تمارين (${workouts.length})` : `تغذية (${nutrition.length})`}
          </button>
        ))}
      </div>

      {tab === "posts" && (
        <>
          <div className="flex items-center justify-end">
            <div className="flex bg-muted rounded-xl p-1">
              <button onClick={() => setView("feed")} className={`p-1.5 rounded-lg ${view === "feed" ? "bg-card" : ""}`}><Rows3 className="w-4 h-4" /></button>
              <button onClick={() => setView("grid")} className={`p-1.5 rounded-lg ${view === "grid" ? "bg-card" : ""}`}><Grid3x3 className="w-4 h-4" /></button>
            </div>
          </div>
          {posts.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">لا توجد منشورات</p>}
          {view === "grid" ? (
            <div className="grid grid-cols-3 gap-1">
              {posts.map((p) => (
                <div key={p.id} className="aspect-square rounded-xl bg-muted overflow-hidden">
                  {p.image_url ? <img src={p.image_url} className="w-full h-full object-cover" /> : <div className="p-2 text-xs">{p.content.slice(0, 60)}</div>}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {posts.map((p, i) => (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} key={p.id}>
                  <Card className="rounded-2xl overflow-hidden">
                    {p.image_url && <img src={p.image_url} className="w-full aspect-square object-cover" />}
                    {p.content && <p className="text-sm p-4">{p.content}</p>}
                    <div className="flex items-center gap-3 p-3 pt-0">
                      <button onClick={() => toggleLike(p.id)} className="flex items-center gap-1 text-xs">
                        <Heart className={`w-4 h-4 ${likes.has(p.id) ? "fill-primary text-primary" : ""}`} />
                        {likes.has(p.id) ? "معجبة" : "إعجاب"}
                      </button>
                      <span className="text-[10px] text-muted-foreground">{new Date(p.created_at).toLocaleDateString("ar")}</span>
                    </div>
                    {/* التعليقات — نفس الخاصية الشغالة على منشورات المستخدمات العاديات، الآن متاحة على منشورات المدربات كمان */}
                    <PostCommentsSection postId={p.id} userId={user?.id} />
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </>
      )}

      {/* تمارين — تخطيط عمودي (كل عنصر فوق التاني) عشان يبين كامل بعرض الشاشة بدون ما يتزاحم يمين/شمال */}
      {tab === "workouts" && (
        <div className="grid gap-3">
          {workouts.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">لا توجد خطط تمارين</p>}
          {workouts.map((w) => (
            <Card key={w.id} className="p-4 rounded-2xl">
              <div className="flex flex-col items-center text-center gap-2">
                {w.image_url ? (
                  <img src={w.image_url} className="w-16 h-16 rounded-xl object-cover" />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center"><Dumbbell className="w-6 h-6" /></div>
                )}
                <div className="w-full">
                  <div className="font-bold break-words">{w.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {(Array.isArray(w.exercises) ? w.exercises : []).length} يوم • {w.min_frequency}+/أسبوع
                  </div>
                </div>
              </div>
              {w.description && <p className="text-xs text-muted-foreground mt-3 text-center leading-relaxed">{w.description}</p>}
              {user?.id !== id && (
                <Button size="sm" onClick={() => adoptWorkout(w.id)} className="rounded-xl gradient-primary w-full mt-3">اعتماد</Button>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* تغذية — نفس مبدأ التخطيط العمودي */}
      {tab === "nutrition" && (
        <div className="grid gap-3">
          {nutrition.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">لا توجد خطط تغذية</p>}
          {nutrition.map((n) => (
            <Card key={n.id} className="p-4 rounded-2xl">
              <div className="flex flex-col items-center text-center gap-2">
                <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center"><Apple className="w-6 h-6" /></div>
                <div className="w-full">
                  <div className="font-bold break-words">{n.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {n.min_calories}–{n.max_calories} سعرة • {(Array.isArray(n.meals) ? n.meals : []).length} وجبات
                  </div>
                </div>
              </div>
              {user?.id !== id && (
                <Button size="sm" onClick={() => adoptNutrition(n.id)} className="rounded-xl gradient-primary w-full mt-3">اعتماد</Button>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ==================================================================== */
/* التعليقات على منشورات المدربة — مبنية على جدول post_comments مباشرة   */
/* ==================================================================== */

function PostCommentsSection({ postId, userId }: { postId: string; userId?: string }) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from("post_comments")
      .select("*", { count: "exact", head: true })
      .eq("post_id", postId)
      .then(({ count: c }) => setCount(c ?? 0));
  }, [postId]);

  const loadComments = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("post_comments")
      .select("*, profiles!post_comments_user_id_fkey(full_name, avatar_url)")
      .eq("post_id", postId)
      .order("created_at", { ascending: true });
    if (!error) setComments(data ?? []);
    setLoading(false);
  };

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next && comments.length === 0) loadComments();
  };

  const submitComment = async () => {
    if (!userId) {
      toast.error("لازم تسجّلي دخول للتعليق");
      return;
    }
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const { data, error } = await supabase
        .from("post_comments")
        .insert({ post_id: postId, user_id: userId, content: text.trim() })
        .select("*, profiles!post_comments_user_id_fkey(full_name, avatar_url)")
        .single();
      if (error) throw error;
      setComments((prev) => [...prev, data]);
      setCount((c) => (c ?? 0) + 1);
      setText("");
    } catch (err: any) {
      toast.error(err.message ?? "تعذر إضافة التعليق");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="px-4 pb-4 pt-1 border-t border-border/60 mt-1">
      <button
        type="button"
        onClick={toggleOpen}
        className="flex items-center gap-1.5 text-xs text-muted-foreground font-semibold py-2"
      >
        <MessageCircle className="w-3.5 h-3.5" />
        {count === null ? "…" : count} {count === 1 ? "تعليق" : "تعليقات"}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-2.5 pb-2">
              {loading && <p className="text-[11px] text-muted-foreground">جارِ تحميل التعليقات...</p>}

              {!loading && comments.length === 0 && (
                <p className="text-[11px] text-muted-foreground">كوني أول من يعلّق على هذا المنشور</p>
              )}

              {!loading &&
                comments.map((c) => (
                  <div key={c.id} className="flex items-start gap-2">
                    {c.profiles?.avatar_url ? (
                      <img src={c.profiles.avatar_url} className="w-7 h-7 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold shrink-0">
                        {c.profiles?.full_name?.[0] ?? "؟"}
                      </div>
                    )}
                    <div className="bg-muted rounded-2xl px-3 py-1.5 flex-1 min-w-0">
                      <div className="text-[11px] font-bold truncate">{c.profiles?.full_name ?? "مستخدمة"}</div>
                      <div className="text-xs break-words">{c.content}</div>
                    </div>
                  </div>
                ))}

              {userId && (
                <div className="flex items-center gap-2 pt-1">
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitComment();
                    }}
                    placeholder="أضيفي تعليق..."
                    className="flex-1 h-9 rounded-full border border-input bg-background px-3.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    onClick={submitComment}
                    disabled={sending || !text.trim()}
                    className="w-9 h-9 shrink-0 rounded-full gradient-primary flex items-center justify-center disabled:opacity-40"
                  >
                    <Send className="w-3.5 h-3.5 text-white" />
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}