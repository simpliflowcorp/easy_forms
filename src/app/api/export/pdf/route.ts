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
    const rowHeight = 25;
    const margin = 50;
    const borderColor = rgb(0, 0, 0);
    const maxColumnsPerPage = 6; // Maximum number of columns per page

    // Get labels (column names)
    const labels = Object.keys(responses[0].data);
    const columnChunks = [];
    for (let i = 0; i < labels.length; i += maxColumnsPerPage) {
      columnChunks.push(labels.slice(i, i + maxColumnsPerPage));
    }

    columnChunks.forEach((columnSet, chunkIndex) => {
      let page = pdfDoc.addPage([595.28, 841.89]); // Standard A4 size
      let yPos = 750; // Start position for first row

      // Calculate column widths dynamically
      const colWidths = [
        50, // Serial Number column
        ...columnSet.map((label) =>
          Math.max(120, font.widthOfTextAtSize(label, 12) + 20)
        ),
      ];
      const totalWidth = colWidths.reduce((a, b) => a + b, 0);
      const maxWidth = 495.28; // A4 width minus margins

      // Adjust column width if total is greater than max width
      if (totalWidth > maxWidth) {
        const scaleFactor = maxWidth / totalWidth;
        colWidths.forEach((_, i) => (colWidths[i] *= scaleFactor));
      }

      // Calculate vertical line positions
      const verticalXs = [margin];
      colWidths.reduce((acc, width) => {
        const newX = acc + width;
        verticalXs.push(newX);
        return newX;
      }, margin);

      const drawBorders = (startY, endY) => {
        page.drawLine({
          start: { x: margin, y: startY },
          end: { x: margin + totalWidth, y: startY },
          thickness: 1,
          color: borderColor,
        });
        page.drawLine({
          start: { x: margin, y: endY },
          end: { x: margin + totalWidth, y: endY },
          thickness: 1,
          color: borderColor,
        });
        verticalXs.forEach((x) => {
          page.drawLine({
            start: { x, y: startY },
            end: { x, y: endY },
            thickness: 1,
            color: borderColor,
          });
        });
      };

      // Draw header row
      page.drawRectangle({
        x: margin,
        y: yPos - rowHeight,
        width: totalWidth,
        height: rowHeight,
        color: rgb(0.9, 0.9, 0.9),
      });
      let xPos = margin;
      page.drawText("S. No", {
        x: xPos + 8,
        y: yPos - 18,
        size: 12,
        font,
        color: borderColor,
      });
      xPos += colWidths[0];

      columnSet.forEach((label, i) => {
        page.drawText(label, {
          x: xPos + 8,
          y: yPos - 18,
          size: 12,
          font,
          color: borderColor,
        });
        xPos += colWidths[i + 1];
      });
      drawBorders(yPos, yPos - rowHeight);

      // Draw responses
      responses.forEach((response, index) => {
        yPos -= rowHeight;
        if (yPos < 100) {
          page = pdfDoc.addPage([595.28, 841.89]);
          yPos = 750;
          drawBorders(yPos, yPos - rowHeight);
        }

        xPos = margin;
        page.drawText((index + 1).toString(), {
          x: xPos + 8,
          y: yPos - 18,
          size: 10,
          font,
          color: borderColor,
        });
        xPos += colWidths[0];

        columnSet.forEach((label, i) => {
          const value = response.data[label]?.toString() || "-";
          const wrappedText = splitText(value, 40);

          wrappedText.forEach((line, lineIndex) => {
            page.drawText(line, {
              x: xPos + 8,
              y: yPos - 18 - lineIndex * 12,
              size: 10,
              font,
              color: borderColor,
            });
          });

          xPos += colWidths[i + 1];
        });
        drawBorders(yPos, yPos - rowHeight);
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

// Helper function to split text into multiple lines
function splitText(text: string, maxLength: number) {
  const words = text.split(" ");
  let currentLine = "";
  const lines: string[] = [];

  words.forEach((word) => {
    if ((currentLine + word).length > maxLength) {
      lines.push(currentLine.trim());
      currentLine = word + " ";
    } else {
      currentLine += word + " ";
    }
  });

  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  return lines;
}
