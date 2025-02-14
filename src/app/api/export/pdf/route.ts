// app/api/export/pdf/route.ts
import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import Response from "@/models/responseModel";
import Form from "@/models/formModel";
import { connectDB } from "@/dbConfig/dbConfig";

export async function GET(request: Request) {
  try {
    await connectDB();

    const { searchParams } = new URL(request.url);
    const formId = searchParams.get("formId");

    // Validate formId (same as previous)
    const form = await Form.findById(formId);
    const cursor = Response.find({ form_id: formId }).lean().cursor();

    // Create transform stream
    const transformStream = new TransformStream();
    const writer = transformStream.writable.getWriter();

    // PDF generation (non-blocking)
    (async () => {
      try {
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        // Initial PDF setup
        let page = pdfDoc.addPage([595.28, 841.89]); // A4 dimensions
        let yPos = 750;

        // Write initial PDF bytes
        const headerBytes = await pdfDoc.save();
        writer.write(new Uint8Array(headerBytes));

        // Process responses in chunks
        for await (const response of cursor) {
          const text = Object.values(response.data).join(" | ");

          if (yPos < 50) {
            page = pdfDoc.addPage([595.28, 841.89]);
            yPos = 750;
          }

          page.drawText(text, {
            x: 50,
            y: yPos,
            size: 10,
            font,
            color: rgb(0, 0, 0),
          });

          yPos -= 15;

          // Stream incremental updates
          const incrementalBytes = await pdfDoc.save({ incremental: true });
          writer.write(new Uint8Array(incrementalBytes));
        }

        // Finalize and close
        const finalBytes = await pdfDoc.save();
        writer.write(new Uint8Array(finalBytes));
        writer.close();
      } catch (error) {
        writer.abort(error);
      }
    })();

    return new NextResponse(transformStream.readable, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${form?.name}_responses.pdf"`,
      },
    });
  } catch (error) {
    console.error("[PDF_GEN_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
