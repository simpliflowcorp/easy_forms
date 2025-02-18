export default function generateColorShades(
  startColor: string,
  endColor: string,
  numShades: number
) {
  if (numShades === 1) return [startColor];

  const shades = [];

  // Convert hex to RGB
  const startRGB = {
    r: parseInt(startColor.slice(1, 3), 16),
    g: parseInt(startColor.slice(3, 5), 16),
    b: parseInt(startColor.slice(5, 7), 16),
  };
  const endRGB = {
    r: parseInt(endColor.slice(1, 3), 16),
    g: parseInt(endColor.slice(3, 5), 16),
    b: parseInt(endColor.slice(5, 7), 16),
  };

  // Generate shades
  for (let i = 0; i < numShades; i++) {
    const ratio = i / (numShades - 1);
    const r = Math.round(startRGB.r + (endRGB.r - startRGB.r) * ratio);
    const g = Math.round(startRGB.g + (endRGB.g - startRGB.g) * ratio);
    const b = Math.round(startRGB.b + (endRGB.b - startRGB.b) * ratio);

    // Convert RGB back to hex and add to array
    const hexColor = `#${r.toString(16).padStart(2, "0")}${g
      .toString(16)
      .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    shades.push(hexColor);
  }

  return shades;
}
