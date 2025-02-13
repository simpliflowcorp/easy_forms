import "@lottiefiles/lottie-player";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "lottie-player": any;
    }
  }
}

const SuccessAnimation = () => {
  return (
    <lottie-player
      src="/animation/successLight.json" // Place the .lottie file in the /public folder (for Next.js)
      background="transparent"
      speed="0.8"
      style={{ width: 350, height: 350 }}
      autoplay
    />
  );
};

export default SuccessAnimation;
