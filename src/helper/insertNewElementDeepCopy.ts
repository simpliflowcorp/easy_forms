export const insertNewElementDeepCopy = (
  items: any[],
  overElementId: number,
  activeElement: any,
  column: number,
  generateId: () => number
) => {
  // Step 1: Deep copy items
  const copiedItems = JSON.parse(JSON.stringify(items));

  // Step 2: Generate new ID
  const newId = generateId();

  // Step 3: Build the new element
  const newElement = {
    ...activeElement,
    id: newId,
    elementId: newId,
    label: `${activeElement.label} ${newId}`,
    column,
    ...(needsOptions(activeElement.type) && {
      options: [
        { id: 1, label: "Option 1", value: "Option 1" },
        { id: 2, label: "Option 2", value: "Option 2" },
        { id: 3, label: "Option 3", value: "Option 3" },
      ],
    }),
  };

  // Step 4: Find index to insert
  const overIndex = copiedItems.findIndex(
    (el: any) => el.elementId === overElementId
  );

  // Step 5: Insert new element at that index
  const updatedItems = [
    ...copiedItems.slice(0, overIndex),
    newElement,
    ...copiedItems.slice(overIndex),
  ];

  return updatedItems;
};

function needsOptions(type: any) {
  // Common types that need options in forms
  const typesWithOptions = [
    "select",
    "dropdown",
    "radio",
    "checkbox",
    "multiselect",
  ];

  return (
    typeof type === "string" && typesWithOptions.includes(type.toLowerCase())
  );
}
