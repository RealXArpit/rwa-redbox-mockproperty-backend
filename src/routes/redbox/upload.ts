import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import * as pdfParse from "pdf-parse";
import * as mammoth from "mammoth";
import { fromBuffer } from "pdf2pic";
import {
  openai,
  EXTRACTION_SYSTEM_PROMPT,
  type ExtractionResult,
} from "../../lib/openai";

const pdf = (pdfParse as any).default ?? pdfParse;
const router = new Hono();

// Helper: convert image buffer to base64 string for OpenAI vision
function bufferToBase64(buffer: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

// Helper: extract text from PDF using pdf-parse
async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const pdfData = await pdf(buffer);
    return (pdfData.text ?? "").trim();
  } catch {
    return "";
  }
}

// Helper: convert PDF pages to base64 images using pdf2pic
async function convertPdfToImages(buffer: Buffer): Promise<string[]> {
  try {
    console.log('Converting PDF to images via ImageMagick...');
    const { execSync } = await import('child_process');
    const { writeFileSync, readFileSync, unlinkSync, existsSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');

    // Write PDF to a temp file
    const tmpPdf = join(tmpdir(), `brochure-${Date.now()}.pdf`);
    const tmpOut = join(tmpdir(), `brochure-${Date.now()}-page`);
    writeFileSync(tmpPdf, buffer);

    // Use magick to convert first 3 pages to PNG
    try {
      execSync(`magick -density 150 "${tmpPdf}[0-2]" -quality 85 "${tmpOut}-%d.png"`, {
        timeout: 30000,
      });
    } catch (err: any) {
      console.error('magick command failed:', err?.message);
      // Try old convert command as fallback
      try {
        execSync(`convert -density 150 "${tmpPdf}[0-2]" -quality 85 "${tmpOut}-%d.png"`, {
          timeout: 30000,
        });
      } catch (err2: any) {
        console.error('convert command also failed:', err2?.message);
        unlinkSync(tmpPdf);
        return [];
      }
    }

    // Read the generated PNG files
    const images: string[] = [];
    for (let i = 0; i <= 2; i++) {
      const imgPath = `${tmpOut}-${i}.png`;
      if (existsSync(imgPath)) {
        const imgBuffer = readFileSync(imgPath);
        images.push(`data:image/png;base64,${imgBuffer.toString('base64')}`);
        unlinkSync(imgPath); // clean up
      }
    }

    unlinkSync(tmpPdf); // clean up temp PDF
    console.log(`Converted ${images.length} pages to images`);
    return images;

  } catch (err: any) {
    console.error('PDF to image conversion failed:', err?.message ?? err);
    return [];
  }
}

// Helper: chunk text into 250-word pieces with 50-word overlap
function chunkText(text: string): string {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 200) {
    chunks.push(words.slice(i, i + 250).join(" "));
  }
  return chunks.map((chunk, i) => `[Chunk ${i}]:\n${chunk}`).join("\n\n");
}

const router_instance = new Hono();

router_instance.post("/upload", async (c) => {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // 1. Get uploaded file
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "Invalid form data" }, 400);
  }

  const file = formData.get("brochure") as File | null;
  if (!file) return c.json({ error: "No file provided" }, 400);

  const allowedTypes = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
  ];

  if (!allowedTypes.includes(file.type)) {
    return c.json(
      { error: "Unsupported file type. Upload PDF, Word doc, or image." },
      415,
    );
  }
  if (file.size > 50 * 1024 * 1024) {
    return c.json({ error: "File too large. Maximum 50 MB." }, 413);
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // 2. Process file based on type
  let extractionMode: "text" | "images" = "text";
  let textContent = "";
  let imageContents: string[] = [];

  if (file.type === "application/pdf") {
    // Try text extraction first
    textContent = await extractPdfText(buffer);

    if (textContent.length < 20) {
      // Scanned PDF — convert to images
      console.log("Scanned PDF detected, converting to images...");
      imageContents = await convertPdfToImages(buffer);

      if (imageContents.length === 0) {
        return c.json(
          {
            error:
              "Could not process this PDF. Please try uploading as an image.",
          },
          422,
        );
      }
      extractionMode = "images";
    } else {
      extractionMode = "text";
    }
  } else if (
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.type === "application/msword"
  ) {
    // Word document — extract text with mammoth
    try {
      const result = await (mammoth as any).extractRawText({ buffer });
      textContent = result.value.trim();
    } catch (err) {
      console.error("Word doc extraction failed:", err);
      return c.json({ error: "Could not read Word document." }, 422);
    }

    if (textContent.length < 20) {
      return c.json({ error: "Word document appears to be empty." }, 422);
    }
    extractionMode = "text";
  } else {
    // Regular image (jpg, png, webp)
    imageContents = [bufferToBase64(buffer, file.type)];
    extractionMode = "images";
  }

  // 3. Call OpenAI
  let extraction: ExtractionResult;
  let aiRaw = "";

  try {
    let completion;

    if (extractionMode === "text") {
      // Send chunked text
      const chunkedText = chunkText(textContent);
      completion = await openai.chat.completions.create({
        model: "gpt-4o",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Extract property details from this brochure:\n\n${chunkedText}`,
          },
        ],
      });
    } else {
      // Send images (up to 3 pages)
      const imageMessages = imageContents.map((imgData) => ({
        type: "image_url" as const,
        image_url: { url: imgData },
      }));

      completion = await openai.chat.completions.create({
        model: "gpt-4o",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              ...imageMessages,
              {
                type: "text",
                text: "Extract property details from these brochure pages.",
              },
            ],
          },
        ],
      });
    }

    aiRaw = completion.choices[0].message.content ?? "";
    extraction = JSON.parse(aiRaw) as ExtractionResult;
  } catch (err) {
    console.error("OpenAI extraction failed:", err);
    return c.json({ error: "AI extraction failed. Please try again." }, 502);
  }

  // 4. Store file in Supabase Storage
  const ext = file.name.split(".").pop() ?? "bin";
  const storagePath = `${Date.now()}.${ext}`;
  let finalStoragePath = "";

  try {
    const { error: storageError } = await supabase.storage
      .from("brochures")
      .upload(storagePath, buffer, { contentType: file.type });

    if (storageError) {
      console.error("Storage upload failed:", storageError.message);
    } else {
      finalStoragePath = storagePath;
    }
  } catch (err) {
    console.error("Storage exception:", err);
  }

  // 5. Save to database
  const { data: submission, error: dbError } = await supabase
    .from("property_submissions")
    .insert({
      brochure_url: finalStoragePath,
      brochure_type: file.type.includes("pdf")
        ? "pdf"
        : file.type.includes("word")
          ? "docx"
          : "image",
      property_name: extraction.propertyName,
      unit_number: extraction.unitNumber,
      area_sqft: extraction.areaSqft,
      address: extraction.address,
      property_type: extraction.propertyType,
      description: extraction.description,
      highlights: extraction.highlights,
      why_invest: extraction.whyInvest,
      psf_price: extraction.psfPrice,
      psf_source: extraction.psfMissing ? null : "ai_extracted",
      status: "draft",
      ai_raw_response: aiRaw,
    })
    .select("id")
    .single();

  if (dbError || !submission) {
    console.error("DB insert failed:", JSON.stringify(dbError, null, 2));
    return c.json(
      { error: "Failed to save submission", detail: dbError?.message },
      500,
    );
  }

  return c.json({ submissionId: submission.id, extraction });
});

export default router_instance;
