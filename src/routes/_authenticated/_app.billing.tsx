import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Wallet,
  Plus,
  TrendingUp,
  AlertTriangle,
  Clock,
  Banknote,
  Landmark,
  CreditCard,
  ChevronDown,
  ChevronUp,
  Trash2,
  CalendarDays,
  Users,
  Package,
} from "lucide-react";

// جدول subscription_payments جديد كليًا، لسا مش موجود بملف الأنواع التلقائي تبع Supabase
// فبنعامله كـ any (نفس نمط "db" المستخدم بباقي الصفحات) لتفادي أخطاء TypeScript
const db = supabase as any;

type PaymentMethod = "cash" | "transfer" | "card";

type Payment = {
  id: string;
  subscriber_id: string;
  package_name: string;
  amount: number;
  payment_method: PaymentMethod;
  paid_at: string;
  duration_days: number;
  expires_at: string;
  notes: string | null;
};

type SubscriberOption = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "كاش",
  transfer: "تحويل",
  card: "بطاقة",
};

const PAYMENT_METHOD_ICONS: Record<PaymentMethod, React.ReactNode> = {
  cash: <Banknote className="w-3.5 h-3.5" />,
  transfer: <Landmark className="w-3.5 h-3.5" />,
  card: <CreditCard className="w-3.5 h-3.5" />,
};

const DURATION_PRESETS = [
  { label: "أسبوع", days: 7 },
  { label: "شهر", days: 30 },
  { label: "3 أشهر", days: 90 },
  { label: "سنة", days: 365 },
];

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// نحسب فرق الأيام بين اليوم وتاريخ معيّن (سالب = متأخر)
function daysUntil(dateStr: string): number {
  const target = new Date(dateStr + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatMoney(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return `${rounded.toLocaleString("ar-JO", {
    minimumFractionDigits: rounded % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })} د.أ`;
}

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat("ar", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(dateStr + "T00:00:00")
  );
}

export const Route = createFileRoute("/_authenticated/_app/billing")({
  head: () => ({ meta: [{ title: "الاشتراكات والمصاريف — EVOLVA" }] }),
  component: BillingPage,
});

function BillingPage() {
  const { user, role } = useAuth();
  const navigate = useNavigate();

  // الصفحة حصرًا للمدربات — أي حد ثاني بيتحول عالرئيسية فورًا
  useEffect(() => {
    if (role && role !== "trainer") {
      navigate({ to: "/home" });
    }
  }, [role, navigate]);

  const [subscribers, setSubscribers] = useState<SubscriberOption[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // حقول نموذج الدفعة الجديدة
  const [formSubscriberId, setFormSubscriberId] = useState("");
  const [formPackage, setFormPackage] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formDuration, setFormDuration] = useState(30);
  const [formMethod, setFormMethod] = useState<PaymentMethod>("cash");
  const [formPaidAt, setFormPaidAt] = useState(todayKey());
  const [formNotes, setFormNotes] = useState("");

  const loadData = async (trainerId: string) => {
    setLoading(true);
    setErrorMsg(null);

    // بنجيب معرّفات كل المدربات عشان نستثنيهن — العضوات هني كل يلي بجدول profiles وما إلهن سجل بـ trainer_profiles
    const { data: trainerRows, error: trainerErr } = await supabase
      .from("trainer_profiles")
      .select("user_id");

    if (trainerErr) {
      console.error("load trainer ids error:", trainerErr);
    }
    const trainerIds = new Set((trainerRows ?? []).map((t: any) => t.user_id as string));

    const { data: allProfiles, error: profErr } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url");

    if (profErr) {
      console.error("load profiles error:", profErr);
      setErrorMsg("صار خطأ بجلب قائمة الأعضاء");
      setLoading(false);
      return;
    }

    const members = (allProfiles ?? []).filter((p: any) => !trainerIds.has(p.id));
    setSubscribers(members);

    const { data: payRows, error: payErr } = await db
      .from("subscription_payments")
      .select("*")
      .eq("trainer_id", trainerId)
      .order("paid_at", { ascending: false });

    if (payErr) {
      console.error("load payments error:", payErr);
      setErrorMsg("صار خطأ بجلب سجل الدفعات — تأكدي إنك نفذتي كود SQL تبع جدول subscription_payments بقاعدة البيانات");
      setLoading(false);
      return;
    }

    setPayments(payRows ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    loadData(user.id);
  }, [user]);

  const paymentsBySubscriber = useMemo(() => {
    const m = new Map<string, Payment[]>();
    payments.forEach((p) => {
      if (!m.has(p.subscriber_id)) m.set(p.subscriber_id, []);
      m.get(p.subscriber_id)!.push(p);
    });
    return m;
  }, [payments]);

  // بطاقة مالية لكل مشتركة نشطة، حتى لو ما دفعت لهلأ ولا وحدة دفعة
  const subscriberCards = useMemo(() => {
    const list = subscribers.map((s) => {
      const subPayments = (paymentsBySubscriber.get(s.id) ?? []).sort(
        (a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime()
      );
      const latest = subPayments[0] ?? null;
      const daysLeft = latest ? daysUntil(latest.expires_at) : null;
      const totalPaid = subPayments.reduce((sum, p) => sum + Number(p.amount), 0);

      let statusRank: number; // ترتيب الأولوية: 0 = الأهم (متأخرة)
      let statusLabel: string;
      let statusClass: string;

      if (!latest) {
        statusRank = 1;
        statusLabel = "بدون دفعات مسجّلة";
        statusClass = "text-muted-foreground bg-muted";
      } else if (daysLeft! < 0) {
        statusRank = 0;
        statusLabel = `متأخرة ${Math.abs(daysLeft!)} يوم`;
        statusClass = "text-destructive bg-destructive/10";
      } else if (daysLeft! <= 5) {
        statusRank = 2;
        statusLabel = daysLeft === 0 ? "تنتهي اليوم" : `تنتهي خلال ${daysLeft} يوم`;
        statusClass = "text-orange-600 bg-orange-500/10";
      } else {
        statusRank = 3;
        statusLabel = `نشطة (${daysLeft} يوم متبقي)`;
        statusClass = "text-emerald-600 bg-emerald-500/10";
      }

      return { subscriber: s, subPayments, latest, daysLeft, totalPaid, statusRank, statusLabel, statusClass };
    });

    return list.sort((a, b) => a.statusRank - b.statusRank);
  }, [subscribers, paymentsBySubscriber]);

  const summary = useMemo(() => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const thisMonth = payments
      .filter((p) => p.paid_at.startsWith(monthKey))
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const total = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const overdueCount = subscriberCards.filter((c) => c.latest && c.daysLeft! < 0).length;
    const dueSoonCount = subscriberCards.filter((c) => c.latest && c.daysLeft! >= 0 && c.daysLeft! <= 5).length;
    return { thisMonth, total, overdueCount, dueSoonCount };
  }, [payments, subscriberCards]);

  const resetForm = () => {
    setFormSubscriberId("");
    setFormPackage("");
    setFormAmount("");
    setFormDuration(30);
    setFormMethod("cash");
    setFormPaidAt(todayKey());
    setFormNotes("");
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (!formSubscriberId || !formPackage.trim() || !formAmount || Number(formAmount) <= 0 || !formDuration) {
      setErrorMsg("عبّي كل الحقول المطلوبة (المشتركة، اسم الباقة، المبلغ، والمدة) قبل الحفظ");
      return;
    }

    setSaving(true);
    setErrorMsg(null);

    const { data, error } = await db
      .from("subscription_payments")
      .insert({
        trainer_id: user.id,
        subscriber_id: formSubscriberId,
        package_name: formPackage.trim(),
        amount: Number(formAmount),
        payment_method: formMethod,
        paid_at: formPaidAt,
        duration_days: formDuration,
        notes: formNotes.trim() || null,
      })
      .select()
      .maybeSingle();

    setSaving(false);

    if (error) {
      console.error("insert payment error:", error);
      setErrorMsg("صار خطأ بحفظ الدفعة — تأكدي إنك نفذتي كود SQL تبع الجدول والصلاحيات كامل");
      return;
    }

    if (data) {
      setPayments((prev) => [data, ...prev]);
      setExpandedId(formSubscriberId);
    }
    resetForm();
    setDialogOpen(false);
  };

  const handleDelete = async (paymentId: string) => {
    setDeletingId(paymentId);
    const { error } = await db.from("subscription_payments").delete().eq("id", paymentId);
    setDeletingId(null);
    if (error) {
      console.error("delete payment error:", error);
      setErrorMsg("صار خطأ بحذف الدفعة");
      return;
    }
    setPayments((prev) => prev.filter((p) => p.id !== paymentId));
  };

  if (role && role !== "trainer") return null;

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between gap-3"
      >
        <div>
          <p className="text-muted-foreground text-sm flex items-center gap-1.5">
            <Wallet className="w-4 h-4" /> إدارة الاشتراكات
          </p>
          <h1 className="text-2xl font-extrabold mt-1">الاشتراكات والمصاريف</h1>
        </div>

        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button className="gap-1.5 rounded-2xl font-bold" disabled={subscribers.length === 0}>
              <Plus className="w-4 h-4" /> دفعة جديدة
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle>تسجيل دفعة اشتراك</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <Label>المشتركة</Label>
                <Select value={formSubscriberId} onValueChange={setFormSubscriberId}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختاري المشتركة" />
                  </SelectTrigger>
                  <SelectContent>
                    {subscribers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.full_name ?? "مستخدمة بدون اسم"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>اسم الباقة</Label>
                <Input
                  value={formPackage}
                  onChange={(e) => setFormPackage(e.target.value)}
                  placeholder="مثلاً: باقة شهرية VIP"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>المبلغ (د.أ)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.5"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>تاريخ الدفع</Label>
                  <Input type="date" value={formPaidAt} onChange={(e) => setFormPaidAt(e.target.value)} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>مدة الاشتراك</Label>
                <div className="flex flex-wrap gap-1.5">
                  {DURATION_PRESETS.map((preset) => (
                    <button
                      key={preset.days}
                      type="button"
                      onClick={() => setFormDuration(preset.days)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                        formDuration === preset.days
                          ? "gradient-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <Input
                  type="number"
                  min="1"
                  value={formDuration}
                  onChange={(e) => setFormDuration(Number(e.target.value))}
                  className="mt-1.5"
                />
                <p className="text-[11px] text-muted-foreground">عدد الأيام — تاريخ الاستحقاق بينحسب تلقائيًا منه</p>
              </div>

              <div className="space-y-1.5">
                <Label>طريقة الدفع</Label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setFormMethod(m)}
                      className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition ${
                        formMethod === m ? "gradient-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {PAYMENT_METHOD_ICONS[m]} {PAYMENT_METHOD_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>ملاحظات (اختياري)</Label>
                <Textarea
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="أي تفاصيل إضافية..."
                  rows={2}
                />
              </div>

              {errorMsg && (
                <p className="text-xs text-destructive bg-destructive/10 rounded-xl p-2.5 text-center">{errorMsg}</p>
              )}

              <Button onClick={handleSubmit} disabled={saving} className="w-full rounded-2xl font-bold">
                {saving ? "عم نحفظ..." : "حفظ الدفعة"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </motion.div>

      {errorMsg && !dialogOpen && (
        <Card className="p-3.5 rounded-2xl border-none bg-destructive/10 text-destructive text-sm text-center font-bold">
          {errorMsg}
        </Card>
      )}

      {/* ملخص مالي */}
      <div className="grid grid-cols-2 gap-3">
        {loading ? (
          <>
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </>
        ) : (
          <>
            <Card className="p-4 rounded-2xl border-none shadow-soft gradient-primary text-primary-foreground">
              <div className="flex items-center gap-1.5 text-xs opacity-90">
                <TrendingUp className="w-3.5 h-3.5" /> إيرادات هالشهر
              </div>
              <div className="text-2xl font-extrabold mt-1.5">{formatMoney(summary.thisMonth)}</div>
            </Card>
            <Card className="p-4 rounded-2xl border-none shadow-soft">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Wallet className="w-3.5 h-3.5" /> إجمالي الإيرادات
              </div>
              <div className="text-2xl font-extrabold mt-1.5 text-foreground">{formatMoney(summary.total)}</div>
            </Card>
          </>
        )}
      </div>

      {!loading && (summary.overdueCount > 0 || summary.dueSoonCount > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {summary.overdueCount > 0 && (
            <Card className="p-3.5 rounded-2xl border-none bg-destructive/10 flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
              <div>
                <div className="text-lg font-extrabold text-destructive leading-none">{summary.overdueCount}</div>
                <div className="text-[10px] text-destructive/80 mt-0.5">اشتراك متأخر</div>
              </div>
            </Card>
          )}
          {summary.dueSoonCount > 0 && (
            <Card className="p-3.5 rounded-2xl border-none bg-orange-500/10 flex items-center gap-2.5">
              <Clock className="w-5 h-5 text-orange-600 shrink-0" />
              <div>
                <div className="text-lg font-extrabold text-orange-600 leading-none">{summary.dueSoonCount}</div>
                <div className="text-[10px] text-orange-600/80 mt-0.5">مستحق قريبًا</div>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* قائمة المشتركات المالية */}
      <div>
        <h2 className="font-bold mb-3 flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" /> اشتراكات المشتركات
        </h2>

        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
          </div>
        )}

        {!loading && subscriberCards.length === 0 && (
          <Card className="p-6 text-center rounded-2xl border-dashed">
            <Wallet className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">لا يوجد مشتركات نشطات بعد</p>
          </Card>
        )}

        <div className="space-y-2.5">
          {subscriberCards.map(({ subscriber, subPayments, latest, totalPaid, statusLabel, statusClass }) => {
            const isOpen = expandedId === subscriber.id;
            return (
              <Card key={subscriber.id} className="rounded-2xl overflow-hidden border-none shadow-soft">
                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : subscriber.id)}
                  className="w-full flex items-center gap-3 p-3.5 text-right"
                >
                  {subscriber.avatar_url ? (
                    <img src={subscriber.avatar_url} className="w-12 h-12 rounded-2xl object-cover shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-2xl gradient-primary text-primary-foreground flex items-center justify-center font-extrabold text-lg shrink-0">
                      {subscriber.full_name?.[0] ?? "؟"}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">{subscriber.full_name ?? "مستخدمة"}</div>
                    <div
                      className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full mt-1 ${statusClass}`}
                    >
                      {statusLabel}
                    </div>
                  </div>

                  <div className="text-center shrink-0 px-1">
                    <div className="text-sm font-extrabold">{formatMoney(totalPaid)}</div>
                    <div className="text-[9px] text-muted-foreground">إجمالي المدفوع</div>
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
                      <div className="px-3.5 pb-4 pt-1 border-t border-border/60 space-y-2.5">
                        {latest && (
                          <div className="flex items-center justify-between text-[11px] bg-muted/60 rounded-xl p-2.5">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <CalendarDays className="w-3.5 h-3.5" /> تاريخ الاستحقاق القادم
                            </span>
                            <span className="font-bold">{formatDate(latest.expires_at)}</span>
                          </div>
                        )}

                        {subPayments.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground text-center py-2">
                            ما في دفعات مسجّلة لهاي المشتركة بعد
                          </p>
                        ) : (
                          <div className="space-y-1.5">
                            {subPayments.map((p) => (
                              <div
                                key={p.id}
                                className="flex items-center justify-between bg-background rounded-xl p-2.5 border border-border/60"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="w-7 h-7 rounded-lg bg-secondary text-primary flex items-center justify-center shrink-0">
                                    <Package className="w-3.5 h-3.5" />
                                  </span>
                                  <div className="min-w-0">
                                    <div className="text-xs font-bold truncate">{p.package_name}</div>
                                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                                      {formatDate(p.paid_at)} · {PAYMENT_METHOD_ICONS[p.payment_method]}{" "}
                                      {PAYMENT_METHOD_LABELS[p.payment_method]}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-xs font-extrabold">{formatMoney(Number(p.amount))}</span>
                                  <button
                                    onClick={() => handleDelete(p.id)}
                                    disabled={deletingId === p.id}
                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
                                    aria-label="حذف الدفعة"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <Button
                          variant="secondary"
                          size="sm"
                          className="w-full rounded-xl gap-1.5 font-bold"
                          onClick={() => {
                            setFormSubscriberId(subscriber.id);
                            setDialogOpen(true);
                          }}
                        >
                          <Plus className="w-3.5 h-3.5" /> تسجيل دفعة جديدة لها
                        </Button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}