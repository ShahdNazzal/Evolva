import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Heart,
  MessageCircle,
  Dumbbell,
  Apple,
  UserPlus,
  UserCheck,
  Sparkles,
  Send,
  Trash2,
  X,
  Quote,
  ArrowRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

// جداول post_likes / post_comments لسا مش موجودة بملف الأنواع التلقائي تبع Supabase
const db = supabase as any;

export const Route = createFileRoute("/_authenticated/_app/trainer/$id")({
  head: () => ({ meta: [{ title: "المدربة — EVOLVA" }] }),
  component: TrainerProfile,
});

type PostMeta = { likesCount: number; likedByMe: boolean; commentsCount: number };

function TrainerProfile() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isOwnProfile = user?.id === id;

  const [trainer, setTrainer] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [postsMeta, setPostsMeta] = useState<Record<string, PostMeta>>({});
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [workouts, setWorkouts] = useState<any[]>([]);
  const [nutrition, setNutrition] = useState<any[]>([]);
  const [tab, setTab] = useState<"posts" | "workouts" | "nutrition">("posts");
  const [following, setFollowing] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [openPost, setOpenPost] = useState<any>(null);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);

  // نفس منطق جلب المنشورات + اللايكات + عدد التعليقات المستخدم بصفحة بروفايل المشتركة العامة (u/$id)
  const loadPosts = async () => {
    setLoadingPosts(true);
    const { data: ps, error } = await supabase
      .from("posts")
      .select("*")
      .eq("author_id", id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("loadPosts error:", error);
      setPosts([]);
      setLoadingPosts(false);
      return;
    }

    const rows = ps ?? [];
    setPosts(rows);

    const postIds = rows.map((p: any) => p.id);
    if (postIds.length === 0) {
      setPostsMeta({});
      setLoadingPosts(false);
      return;
    }

    const [{ data: likes, error: likesErr }, { data: comments, error: commentsErr }] = await Promise.all([
      db.from("post_likes").select("post_id, user_id").in("post_id", postIds),
      db.from("post_comments").select("post_id").in("post_id", postIds),
    ]);

    if (likesErr) console.error("likes error:", likesErr);
    if (commentsErr) console.error("comments error:", commentsErr);

    const meta: Record<string, PostMeta> = {};
    for (const p of rows) {
      const postLikes = (likes ?? []).filter((l: any) => l.post_id === p.id);
      meta[p.id] = {
        likesCount: postLikes.length,
        likedByMe: postLikes.some((l: any) => l.user_id === user?.id),
        commentsCount: (comments ?? []).filter((c: any) => c.post_id === p.id).length,
      };
    }
    setPostsMeta(meta);
    setLoadingPosts(false);
  };

  const load = async () => {
    const [{ data: t }, { data: p }, { data: ws }, { data: ns }] = await Promise.all([
      supabase.from("trainer_profiles").select("*").eq("user_id", id).maybeSingle(),
      supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
      supabase.from("workouts").select("*").eq("trainer_id", id).order("created_at", { ascending: false }),
      supabase.from("nutrition_plans").select("*").eq("trainer_id", id).order("created_at", { ascending: false }),
    ]);
    setTrainer(t); setProfile(p); setWorkouts(ws ?? []); setNutrition(ns ?? []);

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
    }

    await loadPosts();
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

  const toggleLike = async (post: any) => {
    if (!user) return;
    const meta = postsMeta[post.id] ?? { likesCount: 0, likedByMe: false, commentsCount: 0 };
    if (meta.likedByMe) {
      setPostsMeta((prev) => ({ ...prev, [post.id]: { ...meta, likedByMe: false, likesCount: Math.max(0, meta.likesCount - 1) } }));
      const { error } = await db.from("post_likes").delete().eq("post_id", post.id).eq("user_id", user.id);
      if (error) { toast.error("تعذر إلغاء اللايك"); setPostsMeta((prev) => ({ ...prev, [post.id]: meta })); }
    } else {
      setPostsMeta((prev) => ({ ...prev, [post.id]: { ...meta, likedByMe: true, likesCount: meta.likesCount + 1 } }));
      const { error } = await db.from("post_likes").insert({ post_id: post.id, user_id: user.id });
      if (error) { toast.error("تعذر تسجيل اللايك"); setPostsMeta((prev) => ({ ...prev, [post.id]: meta })); }
    }
  };

  const deletePost = async (post: any) => {
    if (!confirm("حذف المنشور؟")) return;
    const { error } = await supabase.from("posts").delete().eq("id", post.id);
    if (error) return toast.error("تعذر حذف المنشور");
    setPosts((prev) => prev.filter((p) => p.id !== post.id));
    toast.success("تم حذف المنشور");
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
    <div className="space-y-5">
      {/* ============ رأس البروفايل الغامر ============ */}
      <div className="relative -mx-4 sm:mx-0">
        <div className="relative overflow-hidden sm:rounded-[2rem] gradient-blush pt-10 pb-16 px-5">
          <div className="absolute -top-16 -left-10 w-56 h-56 bg-white/25 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -right-10 w-64 h-64 bg-primary/20 rounded-full blur-3xl pointer-events-none" />

          <div className="relative flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate({ to: "/search" })}
              className="rounded-2xl bg-white/50 backdrop-blur hover:bg-white/70 h-9 w-9"
            >
              <ArrowRight className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-primary/80 bg-white/50 backdrop-blur px-3 py-1 rounded-full">
              بروفايل مدربة
            </div>
          </div>
        </div>

        <div className="relative -mt-14 px-5">
          <Card className="p-5 rounded-3xl border-none shadow-elegant">
            <div className="flex items-start gap-4">
              <div className="-mt-10 shrink-0">
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    className="w-24 h-24 rounded-3xl object-cover ring-4 ring-background shadow-elegant"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-3xl gradient-primary ring-4 ring-background shadow-elegant flex items-center justify-center text-3xl font-extrabold text-primary-foreground">
                    {profile?.full_name?.[0]}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 pt-1">
                <div className="font-extrabold text-xl truncate">{profile?.full_name}</div>
                <div className="inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full bg-secondary text-primary mt-1 truncate max-w-full">
                  {trainer?.specialization ?? "مدربة معتمدة"}
                </div>
                {trainer?.experience_years != null && (
                  <div className="text-[11px] text-muted-foreground mt-1.5">{trainer.experience_years} سنوات خبرة</div>
                )}
              </div>
            </div>

            {trainer?.bio && <p className="text-sm mt-4 leading-relaxed text-muted-foreground">{trainer.bio}</p>}

            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border/60">
              <StatPill value={posts.length} label="منشور" />
              <StatPill value={workouts.length} label="خطة تمرين" />
              <StatPill value={nutrition.length} label="خطة تغذية" />
            </div>

            {!isOwnProfile && (
              <div className="mt-4 space-y-2">
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
                  <Button onClick={toggleFollow} variant={following ? "outline" : "secondary"} className="rounded-2xl font-bold">
                    {following ? <><UserCheck className="w-4 h-4 ml-1" /> متابَعة</> : <><UserPlus className="w-4 h-4 ml-1" /> متابعة</>}
                  </Button>
                  <Button
                    onClick={() => navigate({ to: "/chat", search: { with: id } })}
                    variant="outline"
                    className="rounded-2xl font-bold"
                  >
                    <MessageCircle className="w-4 h-4 ml-1" /> رسالة
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ============ التبويبات ============ */}
      <div className="flex gap-2 p-1 bg-muted rounded-2xl">
        {(["posts", "workouts", "nutrition"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 py-2 rounded-xl text-[11px] sm:text-xs font-bold transition truncate px-1 ${
              tab === k ? "bg-card shadow-soft text-primary" : "text-muted-foreground"
            }`}
          >
            {k === "posts" ? `منشورات (${posts.length})` : k === "workouts" ? `تمارين (${workouts.length})` : `تغذية (${nutrition.length})`}
          </button>
        ))}
      </div>

      {/* ============ منشورات — نفس مبدأ اللايكات والتعليقات المستخدم بصفحة المشتركة العامة ============ */}
      {tab === "posts" && (
        <>
          {loadingPosts && <p className="text-xs text-muted-foreground text-center py-6">جاري التحميل...</p>}

          {!loadingPosts && posts.length === 0 && (
            <Card className="p-8 text-center rounded-3xl border-dashed border-none shadow-soft">
              <MessageCircle className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">لا توجد منشورات بعد</p>
            </Card>
          )}

          {!loadingPosts && posts.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {posts.map((p) => (
                <PostTile key={p.id} post={p} meta={postsMeta[p.id] ?? { likesCount: 0, likedByMe: false, commentsCount: 0 }} onOpen={() => setOpenPost(p)} />
              ))}
            </div>
          )}
        </>
      )}

      {/* تمارين — تخطيط عمودي عشان تبين كامل بعرض الشاشة بدون ما تتزاحم */}
      {tab === "workouts" && (
        <div className="grid gap-3">
          {workouts.length === 0 && (
            <Card className="p-8 text-center rounded-3xl border-none shadow-soft">
              <Dumbbell className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">لا توجد خطط تمارين</p>
            </Card>
          )}
          {workouts.map((w) => (
            <Card key={w.id} className="p-4 rounded-3xl border-none shadow-soft">
              <div className="flex flex-col items-center text-center gap-2">
                {w.image_url ? (
                  <img src={w.image_url} className="w-16 h-16 rounded-2xl object-cover" />
                ) : (
                  <div className="w-16 h-16 rounded-2xl bg-secondary text-primary flex items-center justify-center"><Dumbbell className="w-6 h-6" /></div>
                )}
                <div className="w-full">
                  <div className="font-bold break-words">{w.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {(Array.isArray(w.exercises) ? w.exercises : []).length} يوم • {w.min_frequency}+/أسبوع
                  </div>
                </div>
              </div>
              {w.description && <p className="text-xs text-muted-foreground mt-3 text-center leading-relaxed">{w.description}</p>}
              {!isOwnProfile && (
                <Button size="sm" onClick={() => adoptWorkout(w.id)} className="rounded-xl gradient-primary w-full mt-3 font-bold">اعتماد</Button>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* تغذية — نفس مبدأ التخطيط العمودي */}
      {tab === "nutrition" && (
        <div className="grid gap-3">
          {nutrition.length === 0 && (
            <Card className="p-8 text-center rounded-3xl border-none shadow-soft">
              <Apple className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">لا توجد خطط تغذية</p>
            </Card>
          )}
          {nutrition.map((n) => (
            <Card key={n.id} className="p-4 rounded-3xl border-none shadow-soft">
              <div className="flex flex-col items-center text-center gap-2">
                <div className="w-16 h-16 rounded-2xl bg-secondary text-primary flex items-center justify-center"><Apple className="w-6 h-6" /></div>
                <div className="w-full">
                  <div className="font-bold break-words">{n.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {n.min_calories}–{n.max_calories} سعرة • {(Array.isArray(n.meals) ? n.meals : []).length} وجبات
                  </div>
                </div>
              </div>
              {!isOwnProfile && (
                <Button size="sm" onClick={() => adoptNutrition(n.id)} className="rounded-xl gradient-primary w-full mt-3 font-bold">اعتماد</Button>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* لايتبوكس المنشور — عرض موسّع + لايك + فتح التعليقات */}
      <AnimatePresence>
        {openPost && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpenPost(null)}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-background rounded-3xl overflow-hidden max-w-sm w-full max-h-[85vh] overflow-y-auto shadow-elegant"
            >
              {openPost.image_url ? (
                <div className="relative">
                  <img src={openPost.image_url} className="w-full aspect-square object-cover" />
                  <button
                    onClick={() => setOpenPost(null)}
                    className="absolute top-3 left-3 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center"
                  >
                    <X className="w-4 h-4 text-white" />
                  </button>
                </div>
              ) : (
                <div className="relative gradient-primary text-primary-foreground p-8 min-h-[220px] flex items-center">
                  <Quote className="w-8 h-8 opacity-40 absolute top-5 right-5" />
                  <button
                    onClick={() => setOpenPost(null)}
                    className="absolute top-3 left-3 w-8 h-8 rounded-full bg-black/20 flex items-center justify-center"
                  >
                    <X className="w-4 h-4 text-white" />
                  </button>
                  <p className="text-base font-bold leading-relaxed relative">{openPost.content}</p>
                </div>
              )}

              {openPost.image_url && openPost.content && (
                <div className="p-4 text-sm leading-relaxed">{openPost.content}</div>
              )}

              <div className="flex items-center justify-between px-4 py-3 border-t border-border/60">
                <button onClick={() => toggleLike(openPost)} className="flex items-center gap-1.5 text-sm font-bold">
                  <Heart className={`w-5 h-5 ${postsMeta[openPost.id]?.likedByMe ? "fill-primary text-primary" : ""}`} />
                  {postsMeta[openPost.id]?.likesCount ?? 0}
                </button>
                <button onClick={() => setCommentsPostId(openPost.id)} className="flex items-center gap-1.5 text-sm font-bold text-muted-foreground">
                  <MessageCircle className="w-5 h-5" /> {postsMeta[openPost.id]?.commentsCount ?? 0} تعليق
                </button>
                {isOwnProfile && (
                  <button onClick={() => { deletePost(openPost); setOpenPost(null); }} className="text-destructive">
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
              </div>

              <div className="px-4 pb-4 pt-1 text-[10px] text-muted-foreground">
                {new Date(openPost.created_at).toLocaleDateString("ar", { day: "numeric", month: "long", year: "numeric" })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <CommentsDialog
        postId={commentsPostId}
        open={!!commentsPostId}
        onClose={() => setCommentsPostId(null)}
        currentUserId={user?.id ?? null}
        postAuthorId={id}
        onCountChange={(postId: string, count: number) =>
          setPostsMeta((prev) => ({ ...prev, [postId]: { ...(prev[postId] ?? { likesCount: 0, likedByMe: false, commentsCount: 0 }), commentsCount: count } }))
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* عنصر إحصائية صغيرة برأس البروفايل                                    */
/* ------------------------------------------------------------------ */

function StatPill({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="text-center px-3 py-1.5 rounded-xl bg-muted/60">
      <div className="font-extrabold text-sm leading-none">{value}</div>
      <div className="text-[9px] text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* بلاطة منشور — نفس مبدأ التصميم المستخدم بصفحة "ملفي"، مع عدّاد لايكات وتعليقات */
/* ------------------------------------------------------------------ */

function PostTile({ post, meta, onOpen }: { post: any; meta: PostMeta; onOpen: () => void }) {
  const hasImage = !!post.image_url;

  if (hasImage) {
    return (
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={onOpen}
        className="relative aspect-[4/5] rounded-2xl overflow-hidden text-right group"
      >
        <img src={post.image_url} className="w-full h-full object-cover transition group-hover:scale-105" />
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/75 to-transparent" />
        <div className="absolute inset-x-2.5 bottom-2 text-white space-y-1">
          {post.content && <p className="text-[11px] font-semibold leading-tight line-clamp-2">{post.content}</p>}
          <div className="flex items-center gap-3 text-[10px] font-bold">
            <span className="flex items-center gap-1"><Heart className={`w-3 h-3 ${meta.likedByMe ? "fill-white" : ""}`} /> {meta.likesCount}</span>
            <span className="flex items-center gap-1"><MessageCircle className="w-3 h-3" /> {meta.commentsCount}</span>
          </div>
        </div>
      </motion.button>
    );
  }

  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={onOpen}
      className="relative aspect-[4/5] rounded-2xl overflow-hidden text-right p-3.5 flex flex-col justify-between gradient-blush border border-white/40"
    >
      <Quote className="w-5 h-5 text-primary/50 shrink-0" />
      <p className="text-[12.5px] font-bold leading-snug line-clamp-5 text-foreground/90">{post.content}</p>
      <div className="flex items-center gap-3 text-[10px] font-bold text-muted-foreground">
        <span className="flex items-center gap-1"><Heart className={`w-3 h-3 ${meta.likedByMe ? "fill-primary text-primary" : ""}`} /> {meta.likesCount}</span>
        <span className="flex items-center gap-1"><MessageCircle className="w-3 h-3" /> {meta.commentsCount}</span>
      </div>
    </motion.button>
  );
}

/* ==================================================================== */
/* ديالوج التعليقات — نفس التنفيذ المستخدم بصفحة بروفايل المشتركة العامة */
/* ==================================================================== */

function CommentsDialog({ postId, open, onClose, currentUserId, postAuthorId, onCountChange }: any) {
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);

  const load = async () => {
    if (!postId) return;
    setLoading(true);
    const { data, error } = await db
      .from("post_comments")
      .select("*, profiles(full_name, avatar_url)")
      .eq("post_id", postId)
      .order("created_at", { ascending: true });
    if (error) console.error("comments load error:", error);
    setComments(data ?? []);
    onCountChange?.(postId, (data ?? []).length);
    setLoading(false);
  };

  useEffect(() => {
    if (open) load();
    else setText("");
  }, [open, postId]);

  const submit = async () => {
    if (!text.trim() || !currentUserId || !postId) return;
    setPosting(true);
    try {
      const { error } = await db.from("post_comments").insert({
        post_id: postId,
        user_id: currentUserId,
        content: text.trim(),
      });
      if (error) throw error;
      setText("");
      await load();
    } catch (err: any) {
      toast.error(err.message ?? "تعذر إضافة التعليق");
    } finally {
      setPosting(false);
    }
  };

  const remove = async (comment: any) => {
    if (!confirm("حذف التعليق؟")) return;
    const { error } = await db.from("post_comments").delete().eq("id", comment.id);
    if (error) return toast.error("تعذر حذف التعليق");
    await load();
  };

  const canDelete = (comment: any) => currentUserId && (comment.user_id === currentUserId || postAuthorId === currentUserId);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="rounded-3xl max-h-[85vh] overflow-hidden flex flex-col p-0" dir="rtl">
        <DialogHeader className="p-4 pb-2 border-b">
          <DialogTitle>التعليقات</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-2">
          {loading && <p className="text-xs text-muted-foreground text-center py-6">جاري التحميل...</p>}
          {!loading && comments.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">لا توجد تعليقات بعد — كوني أول من يعلق</p>
          )}
          {comments.map((comment) => (
            <div key={comment.id} className="mt-3">
              <div className="flex items-start gap-2">
                {comment.profiles?.avatar_url ? (
                  <img src={comment.profiles.avatar_url} className="w-7 h-7 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-7 h-7 rounded-full gradient-primary flex items-center justify-center text-primary-foreground text-[11px] font-bold shrink-0">
                    {comment.profiles?.full_name?.[0]}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="bg-muted/60 rounded-2xl px-3 py-2">
                    <div className="text-xs font-bold">{comment.profiles?.full_name}</div>
                    <div className="text-sm leading-relaxed">{comment.content}</div>
                  </div>
                  <div className="flex items-center gap-3 mt-1 px-1 text-[10px] text-muted-foreground">
                    <span>{new Date(comment.created_at).toLocaleDateString("ar")}</span>
                    {canDelete(comment) && (
                      <button onClick={() => remove(comment)} className="flex items-center gap-1 font-semibold text-destructive">
                        <Trash2 className="w-3 h-3" /> حذف
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="p-3 border-t flex items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="اكتبي تعليقاً..."
            className="flex-1 rounded-2xl border border-input bg-background px-3 h-10 text-sm"
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <Button size="icon" disabled={posting || !text.trim()} onClick={submit} className="rounded-full gradient-primary shrink-0">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}