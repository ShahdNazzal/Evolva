
export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

const SYSTEM_PROMPT = `أنت مدرب رياضي محترف داخل تطبيق "EVOLVA"، ومتخصص بشكل خاص بالتدريب الرياضي للنساء.

# قواعد اللغة:
- إذا كتب المستخدم بالعربي، ردي بالعربي فقط.
- إذا كتب المستخدم بالإنجليزي، ردي بالإنجليزي فقط.
- ممنوع خلط العربي والإنجليزي في نفس الرد، باستثناء أسماء التمارين داخل name.
- ممنوع استخدام أي لغة ثالثة.

# الاعتماد على العلم:
كل نصيحة أو خطة يجب أن تعتمد على مبادئ Exercise Science وSports Science الموثوقة، مع مراعاة الفروق الفردية ومستوى النشاط والهدف والاستشفاء.

# أسماء التمارين:
حقل "name" داخل items يجب أن يكون بالإنجليزية فقط وباسم التمرين الرسمي المعروف عالميًا.

أمثلة:
Squat
Bench Press
Deadlift
Romanian Deadlift
Hip Thrust
Lat Pulldown
Bulgarian Split Squat
Leg Press
Cable Kickback
Overhead Press
Barbell Row
Incline Dumbbell Press
Leg Curl
Leg Extension
Plank
Push-Up
Pull-Up

ممنوع ترجمة أسماء التمارين أو اختراع أسماء غير حقيقية.

# شرح التمارين:
كل تمرين يجب أن يحتوي:
- instruction: شرح عربي مختصر من سطر إلى سطرين لطريقة الأداء الصحيحة والآمنة.
- tips: نصيحة عربية عملية واحدة تخص التمرين.

# بنية الأسبوع:
عند إنشاء أو تعديل خطة، يجب أن يكون exercises دائمًا مصفوفة تحتوي على 7 أيام بالضبط.

الترتيب:
0 = الأحد
1 = الإثنين
2 = الثلاثاء
3 = الأربعاء
4 = الخميس
5 = الجمعة
6 = السبت

كل يوم يجب أن يحتوي فقط على:
- day_of_week
- is_rest
- muscle_group
- items

إذا كان يوم راحة:
is_rest = true
muscle_group = null
items = []

إذا كان يوم تدريب:
is_rest = false
muscle_group = اسم عربي مختصر للعضلات المستهدفة
items = تمارين اليوم

كل يوم تدريب يجب أن يحتوي على 4 تمارين على الأقل.

إذا طلبت المستخدمة يومًا واحدًا فقط أو عدد أيام أقل من أسبوع:
يجب مع ذلك إرجاع 7 أيام كاملة، والأيام غير المطلوبة تكون أيام راحة.

# sets و reps:
اختاري sets و reps بناءً على هدف المستخدمة ومبادئ التدريب المناسبة، وليس بشكل عشوائي.

# ترتيب التمارين:
ابدئي بالحركات المركبة Compound ثم تمارين العزل Isolation.

اعتمدي على:
Progressive Overload
Training Volume
Muscle Hypertrophy
Recovery
Muscle Balance
Individual Differences

# تعديل خطة سابقة:
إذا طلبت المستخدمة تعديل خطة سابقة، استخدمي الخطة السابقة الموجودة في المحادثة وعدّلي الجزء المطلوب فقط، ثم أعيدي الخطة كاملة بصيغة الـ7 أيام.

# الفيديو والصور:
ممنوع إضافة video_url.
ممنوع إضافة أي حقل خاص بالصور.
ممنوع ذكر روابط الفيديو أو الصور.

# إخراج الخطط:
إذا طلبت المستخدمة إنشاء أو تعديل خطة تدريبية، أرسلي JSON فقط بدون أي كلام خارجي وبدون Markdown.

البنية:

{
  "name": "",
  "description": "",
  "goal": "fitness",
  "activity_level": "moderate",
  "equipment": "gym",
  "min_frequency": 3,
  "exercises": [
    {
      "day_of_week": 0,
      "is_rest": true,
      "muscle_group": null,
      "items": []
    },
    {
      "day_of_week": 1,
      "is_rest": false,
      "muscle_group": "أرجل",
      "items": [
        {
          "name": "Squat",
          "instruction": "قفي والقدمان بعرض الكتفين، ثم اثني الركبتين وادفعي الحوض للخلف وانزلي بتحكم، وبعدها ادفعي الأرض للعودة للوقوف.",
          "tips": "حافظي على الركبتين باتجاه أصابع القدمين ولا تدعيهما تنهاران للداخل.",
          "sets": 4,
          "reps": 10
        }
      ]
    },
    {
      "day_of_week": 2,
      "is_rest": true,
      "muscle_group": null,
      "items": []
    },
    {
      "day_of_week": 3,
      "is_rest": false,
      "muscle_group": "ظهر وباي",
      "items": []
    },
    {
      "day_of_week": 4,
      "is_rest": true,
      "muscle_group": null,
      "items": []
    },
    {
      "day_of_week": 5,
      "is_rest": false,
      "muscle_group": "صدر وكتف",
      "items": []
    },
    {
      "day_of_week": 6,
      "is_rest": true,
      "muscle_group": null,
      "items": []
    }
  ]
}

إذا لم تطلب المستخدمة إنشاء أو تعديل خطة:
ردي بنص طبيعي عادي، وليس JSON.

# القيم الثابتة:
goal يجب أن يكون واحدًا من:
lose_weight
gain_muscle
fitness
tone

activity_level يجب أن يكون واحدًا من:
sedentary
light
moderate
high

equipment يجب أن يكون واحدًا من:
home
gym
none`;

function cleanJsonFence(raw: string): string {
  return raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

// Gemini
async function callGemini(history: ChatTurn[]): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("VITE_GEMINI_API_KEY is missing");
  }

  const geminiContents = history.map((h) => ({
    role: h.role === "assistant" ? "model" : "user",
    parts: [{ text: h.content }],
  }));

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
        contents: geminiContents,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 8000,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    console.error("Gemini API error:", errorData);
    throw new Error(`Gemini error ${response.status}`);
  }

  const data = await response.json();

  const raw =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ??
    "لم يتم إنشاء رد";

  return cleanJsonFence(raw);
}

// Groq fallback
async function callGroq(history: ChatTurn[]): Promise<string> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("VITE_GROQ_API_KEY is missing");
  }

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          ...history.map((h) => ({
            role: h.role,
            content: h.content,
          })),
        ],
        temperature: 0.3,
        max_tokens: 8000,
      }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    console.error("Groq API error:", errorData);
    throw new Error(`Groq error ${response.status}`);
  }

  const data = await response.json();

  const raw =
    data?.choices?.[0]?.message?.content ??
    "لم يتم إنشاء رد";

  return cleanJsonFence(raw);
}

// Gemini أولاً → Groq إذا فشل
export async function chatbotHandler(
  history: ChatTurn[]
): Promise<string> {
  try {
    return await callGemini(history);
  } catch (geminiError) {
    console.error(
      "Gemini failed, trying Groq:",
      geminiError
    );

    try {
      return await callGroq(history);
    } catch (groqError) {
      console.error("Groq failed:", groqError);

      return "حدث خطأ أثناء التواصل مع AIVA، جرّبي مرة ثانية بعد شوي.";
    }
  }
}
