import * as React from "react";

export interface IElementOptionPopupProps {
  isOptionsOpen: boolean;
  closePopup: () => void;
  openElementProps: any;
  deleteElement: (elementId: number) => void;
  data: any;
}

export default function ElementOptionPopup(props: IElementOptionPopupProps) {
  const popupRef = React.useRef<HTMLDivElement | null>(null);

  const handleClickOutside = (event: any) => {
    if (popupRef.current && !popupRef.current.contains(event.target)) {
      props.closePopup(); // Close the popup
    }
  };

  React.useEffect(() => {
    // Add event listener to detect clicks
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      // Cleanup the event listener on component unmount
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div
      ref={popupRef}
      className={
        props.isOptionsOpen
          ? "opts-popup-cnt displayBlock"
          : "opts-popup-cnt displayNone"
      }
    >
      <div className="opts-popup">
        <div
          onClick={() => {
            props.openElementProps(props.data);
            props.closePopup();
          }}
          className="opts-popup-item"
        >
          Edit
        </div>
        <div
          onClick={() => {
            console.log("Delete element", props.data);
            props.deleteElement(props.data);
            props.closePopup();
          }}
          className="opts-popup-item"
        >
          Delete
        </div>
      </div>
    </div>
  );
}
