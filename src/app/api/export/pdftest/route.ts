import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function GET() {
  try {
    // ✅ Create a new PDF
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    let page = pdfDoc.addPage([595.28, 841.89]); // A4 size
    let yPos = 750;

    // ✅ Add test text
    const testData = [
      "Test Line 1",
      "Test Line 2",
      "Test Line 3",
      "Test Line 4",
      "Test Line 5",
    ];

    testData.forEach((text) => {
      if (yPos < 50) {
        page = pdfDoc.addPage([595.28, 841.89]); // Add a new page if needed
        yPos = 750;
      }

      page.drawText(text, {
        x: 50,
        y: yPos,
        size: 12,
        font,
        color: rgb(0, 0, 0),
      });

      yPos -= 20;
    });

    // ✅ Save the PDF as Uint8Array
    const pdfBytes = await pdfDoc.save();
    const uint8Array = new Uint8Array(pdfBytes);

    // ✅ Return as a ReadableStream
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(uint8Array);
        controller.close();
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="test.pdf"`,
      },
    });
  } catch (error) {
    console.error("[TEST_PDF_ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
