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
    let page = pdfDoc.addPage([595.28, 841.89]); // A4 size
    let yPos = 750;
    const rowHeight = 25;
    const margin = 50;
    const borderColor = rgb(0, 0, 0);

    // Determine column widths dynamically
    const labels = form.elements.map((element: any) => element.label);

    const colWidths = [
      50,
      ...labels.map((label) =>
        Math.max(120, font.widthOfTextAtSize(label, 12) + 20)
      ),
    ];
    const totalWidth = colWidths.reduce((a, b) => a + b, 0);

    // Ensure the table fits within the page width
    const maxWidth = 495.28; // A4 width minus margins
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

    // Draw header
    page.drawRectangle({
      x: margin,
      y: yPos - rowHeight,
      width: totalWidth,
      height: rowHeight,
      color: rgb(0.9, 0.9, 0.9),
    });
    let xPos = margin;
    page.drawText("S. No", {
      x: xPos + 4,
      y: yPos - 18,
      size: 12,
      font,
      color: borderColor,
    });
    xPos += colWidths[0];
    labels.forEach((label, i) => {
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

      let xPos = margin;
      const maxWidthPerColumn = colWidths.map((width) => width - 16);

      // Determine max lines needed in this row
      let maxLines = 1;
      const wrappedValues = labels.map((label, i) => {
        const value = response.data[label]?.toString() || "-";
        const wrappedLines = wrapText(
          value,
          maxWidthPerColumn[i + 1],
          font,
          10
        );
        maxLines = Math.max(maxLines, wrappedLines.length);
        return wrappedLines;
      });

      const rowHeightNeeded = maxLines * 12 + 6; // Adjust height

      // Draw serial number (centered)
      const serialTextY = yPos - rowHeightNeeded / 2 - 3; // Center in cell
      page.drawText((index + 1).toString(), {
        x: xPos + 8,
        y: serialTextY,
        size: 10,
        font,
        color: borderColor,
      });
      xPos += colWidths[0];

      // Draw wrapped text for each column, centered
      wrappedValues.forEach((lines, i) => {
        const totalTextHeight = lines.length * 12;
        // const textStartY = yPos - rowHeightNeeded / 2 + totalTextHeight / 2 - 6;
        const textStartY =
          yPos - rowHeightNeeded / 2 + totalTextHeight / 2 - 10;
        lines.forEach((line, lineIndex) => {
          page.drawText(line, {
            x: xPos + 8,
            y: textStartY - lineIndex * 12,
            size: 10,
            font,
            color: borderColor,
          });
        });

        xPos += colWidths[i + 1];
      });

      // Draw table borders with new row height
      drawBorders(yPos, yPos - rowHeightNeeded);
      yPos -= rowHeightNeeded - rowHeight; // Adjust position
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

const wrapText = (text, maxWidth, font, fontSize) => {
  const words = text.split(" ");
  let line = "";
  const lines = [];

  words.forEach((word) => {
    const testLine = line ? line + " " + word : word;
    const textWidth = font.widthOfTextAtSize(testLine, fontSize);

    if (textWidth < maxWidth) {
      line = testLine;
    } else {
      lines.push(line);
      line = word;
    }
  });

  if (line) lines.push(line); // Push the last remaining text
  return lines;
};
