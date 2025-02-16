import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import Response from "@/models/responseModel";
import Form from "@/models/formModel";
import { connectDB } from "@/dbConfig/dbConfig";

export async function GET(request: Request) {
  try {
    await connectDB();

    const form_id = request.headers.get("referer")?.split("/")[4];
    const form = await Form.findOne({ formId: form_id });
    if (!form) {
      return NextResponse.json({ message: "Form not found" }, { status: 404 });
    }

    const responses = await Response.find({ form_id: form._id }).lean();
    if (responses.length === 0) {
      return NextResponse.json(
        { message: "No responses found" },
        { status: 404 }
      );
    }

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const margin = 50;
    const maxColumnsPerPage = 6;
    const lineHeight = 12;
    const headerHeight = 30;
    const rowPadding = 10; // Extra space for better visibility

    const labels = form.elements.map((element: any) => element.label);
    const columnChunks = [];
    for (let i = 0; i < labels.length; i += maxColumnsPerPage) {
      columnChunks.push(labels.slice(i, i + maxColumnsPerPage));
    }

    columnChunks.forEach((columnSet, chunkIndex) => {
      let page = pdfDoc.addPage([595.28, 841.89]); // A4 Page
      let yPos = 800; // Start position

      const colWidths = [
        50,
        ...columnSet.map((label: string) =>
          Math.max(120, font.widthOfTextAtSize(label, 12) + 20)
        ),
      ];

      const totalWidth = colWidths.reduce((a, b) => a + b, 0);
      const maxWidth = 495.28; // A4 width - margins

      if (totalWidth > maxWidth) {
        const scaleFactor = maxWidth / totalWidth;
        colWidths.forEach((_, i) => (colWidths[i] *= scaleFactor));
      }

      let xPos = margin;

      // **Draw Header Row**
      page.drawRectangle({
        x: margin,
        y: yPos - headerHeight,
        width: totalWidth,
        height: headerHeight,
        color: rgb(0.9, 0.9, 0.9),
      });

      page.drawText("S. No", {
        x: xPos + colWidths[0] / 2 - font.widthOfTextAtSize("S. No", 12) / 2,
        y: yPos - 20,
        size: 12,
        font,
      });
      xPos += colWidths[0];

      columnSet.forEach((label: string, i: number) => {
        page.drawText(label, {
          x:
            xPos + colWidths[i + 1] / 2 - font.widthOfTextAtSize(label, 12) / 2,
          y: yPos - 20,
          size: 12,
          font,
        });
        xPos += colWidths[i + 1];
      });

      const drawBorders = (startY: number, endY: number) => {
        page.drawLine({
          start: { x: margin, y: startY },
          end: { x: margin + totalWidth, y: startY },
          thickness: 1,
        });
        page.drawLine({
          start: { x: margin, y: endY },
          end: { x: margin + totalWidth, y: endY },
          thickness: 1,
        });

        const verticalXs = [margin];
        colWidths.reduce((acc, width) => {
          const newX = acc + width;
          verticalXs.push(newX);
          return newX;
        }, margin);

        verticalXs.forEach((x) => {
          page.drawLine({
            start: { x, y: startY },
            end: { x, y: endY },
            thickness: 1,
          });
        });
      };

      drawBorders(yPos, yPos - headerHeight);
      yPos -= headerHeight; // Move down

      // **Draw Response Rows**
      responses.forEach((response, index) => {
        let maxRowHeight = 25;
        const rowTextLines: string[][] = [];

        columnSet.forEach((label: string, i: number) => {
          const text = response.data[label]?.toString() || "-";
          const maxLineWidth = colWidths[i + 1] - 16;
          let wrappedLines: string[] = [];
          let currentLine = "";
          const words = text.split(" ");

          words.forEach((word: string) => {
            let testLine = currentLine ? `${currentLine} ${word}` : word;
            if (font.widthOfTextAtSize(testLine, 10) > maxLineWidth) {
              wrappedLines.push(currentLine);
              currentLine = word;
            } else {
              currentLine = testLine;
            }
          });

          wrappedLines.push(currentLine);
          rowTextLines.push(wrappedLines);
          maxRowHeight = Math.max(
            maxRowHeight,
            wrappedLines.length * lineHeight + rowPadding
          );
        });

        if (yPos - maxRowHeight < 50) {
          page = pdfDoc.addPage([595.28, 841.89]);
          yPos = 800;
        }

        xPos = margin;
        const rowMidY = yPos - maxRowHeight / 2;

        // Draw serial number in center
        page.drawText((index + 1).toString(), {
          x:
            xPos +
            colWidths[0] / 2 -
            font.widthOfTextAtSize((index + 1).toString(), 10) / 2,
          y: rowMidY + lineHeight / 2 - 8,
          size: 10,
          font,
        });
        xPos += colWidths[0];

        columnSet.forEach((label: string, i: number) => {
          const lines = rowTextLines[i];
          let textY = rowMidY + (lines.length * lineHeight) / 2;

          lines.forEach((line: string) => {
            page.drawText(line, {
              x:
                xPos +
                colWidths[i + 1] / 2 -
                font.widthOfTextAtSize(line, 10) / 2,
              y: textY - 8,
              size: 10,
              font,
            });
            textY -= lineHeight;
          });

          xPos += colWidths[i + 1];
        });

        drawBorders(yPos, yPos - maxRowHeight);
        yPos -= maxRowHeight;
      });
    });

    const pdfBytes = await pdfDoc.save();
    return new NextResponse(pdfBytes, {
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
