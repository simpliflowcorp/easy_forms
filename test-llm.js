const apiKey = process.env.NVIDIA_API_KEY;
fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model: "meta/llama-3.3-70b-instruct",
    messages: [{role: "user", content: "hi"}],
  })
}).then(res => res.text()).then(console.log).catch(console.error);
