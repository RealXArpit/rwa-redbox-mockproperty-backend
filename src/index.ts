import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import "dotenv/config";

import redboxUpload from "./routes/redbox/upload";
import redboxSubmit from "./routes/redbox/submit";

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:8080",
      "https://rwaREDbox.com",
      "https://www.rwaREDbox.com",
    ],
  }),
);

app.get("/", (c) => c.json({ status: "RealX Redbox backend is running" }));

app.route("/api/redbox", redboxUpload);
app.route("/api/redbox", redboxSubmit);

app.get("/test-db", async (c) => {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  console.log("URL:", process.env.SUPABASE_URL);
  console.log(
    "KEY prefix:",
    process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 10),
  );

  const { data, error } = await supabase
    .from("property_submissions")
    .insert({ property_name: "Test", status: "draft" })
    .select("id")
    .single();

  if (error) {
    return c.json({
      error: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
  }

  return c.json({ success: true, id: data.id });
});

serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT) || 3000,
  },
  (info) => {
    console.log(`Backend running at http://localhost:${info.port}`);
  },
);
