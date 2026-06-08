import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";

const router = new Hono();

router.post("/submit", async (c) => {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const body = (await c.req.json()) as {
    submissionId: string;
    psfPrice: number;
    psfSource: "ai_extracted" | "user_provided";
    userName: string;
    userPhone: string;
    fields: {
      propertyName: string;
      unitNumber: string;
      areaSqft: number;
      address: string;
      propertyType: string;
      description: string;
      highlights: string[];
      whyInvest: string;
    };
  };

  const { submissionId, psfPrice, psfSource, userName, userPhone, fields } =
    body;

  if (!submissionId || !userName || !userPhone || !psfPrice) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  // Calculate total price (area x PSF — we will add more factors later)
  const totalPrice = (fields.areaSqft ?? 0) * psfPrice;

  // Update the submission in the database
  const { error: updateError } = await supabase
    .from("property_submissions")
    .update({
      property_name: fields.propertyName,
      unit_number: fields.unitNumber,
      area_sqft: fields.areaSqft,
      address: fields.address,
      property_type: fields.propertyType,
      description: fields.description,
      highlights: fields.highlights,
      why_invest: fields.whyInvest,
      psf_price: psfPrice,
      psf_source: psfSource,
      total_price: totalPrice,
      status: "confirmed",
    })
    .eq("id", submissionId);

  if (updateError) {
    console.error("Submission update failed:", updateError);
    return c.json({ error: "Failed to confirm submission" }, 500);
  }

  // Save the lead
  const { error: leadError } = await supabase.from("redbox_leads").insert({
    property_submission_id: submissionId,
    name: userName,
    phone: userPhone,
  });

  if (leadError) {
    console.error("Lead save failed:", leadError);
    // Non-fatal — submission is already saved
  }

  return c.json({
    success: true,
    totalPrice,
    submissionId,
  });
});

export default router;
