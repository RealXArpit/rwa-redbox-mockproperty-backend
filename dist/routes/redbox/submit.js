"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hono_1 = require("hono");
const supabase_js_1 = require("@supabase/supabase-js");
const router = new hono_1.Hono();
router.post("/submit", async (c) => {
    const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const body = (await c.req.json());
    const { submissionId, psfPrice, psfSource, userName, userPhone, fields } = body;
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
exports.default = router;
