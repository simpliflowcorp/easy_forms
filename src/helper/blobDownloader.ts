const blobDownloader = async (
  data: string,
  filename: string,
  type?: string
) => {
  //   const blob = await data.blob(); // Convert response to blob
  const blob = new Blob([data], { type });
  const url = window.URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename; // Set the file name
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
};

export default blobDownloader;
