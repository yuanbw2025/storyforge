package main

import (
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path"
	"runtime"
	"strings"
	"time"
)

const (
	appPath = "/storyforge/"
	port    = "1111"
)

//go:embed web
var embeddedWeb embed.FS

func main() {
	webRoot, err := fs.Sub(embeddedWeb, "web")
	if err != nil {
		fatal("无法读取内置前端文件", err)
	}

	mux := http.NewServeMux()
	registerProviderProxies(mux)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.Redirect(w, r, appPath, http.StatusFound)
			return
		}
		if strings.HasPrefix(r.URL.Path, appPath) {
			serveStoryForgeApp(webRoot, w, r)
			return
		}
		http.NotFound(w, r)
	})

	addr := "127.0.0.1:" + port
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		fmt.Println("StoryForge 可能已经在运行，正在尝试打开浏览器：")
		openBrowser("http://" + addr + appPath)
		fmt.Println("http://" + addr + appPath)
		fmt.Println()
		fmt.Println("如果页面无法打开，请关闭其他占用 1111 端口的程序后再重新启动。")
		waitBeforeExit()
		return
	}

	url := "http://" + addr + appPath
	fmt.Println()
	fmt.Println("============================================")
	fmt.Println(" StoryForge 故事熔炉")
	fmt.Println("============================================")
	fmt.Println("本窗口运行期间不要关闭；关闭窗口即停止本地服务。")
	fmt.Println("正在打开浏览器：", url)
	fmt.Println()

	_ = openBrowser(url)
	server := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 15 * time.Second,
	}
	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fatal("本地服务异常退出", err)
	}
}

func serveStoryForgeApp(root fs.FS, w http.ResponseWriter, r *http.Request) {
	rel := strings.TrimPrefix(r.URL.Path, appPath)
	if rel == "" {
		rel = "index.html"
	}
	rel = path.Clean("/" + rel)
	rel = strings.TrimPrefix(rel, "/")

	if info, err := fs.Stat(root, rel); err == nil && !info.IsDir() {
		serveEmbeddedFile(root, rel, w)
		return
	}

	serveIndex(root, w)
}

func serveIndex(root fs.FS, w http.ResponseWriter) {
	index, err := fs.ReadFile(root, "index.html")
	if err != nil {
		http.Error(w, "StoryForge index.html not found", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(index)
}

func serveEmbeddedFile(root fs.FS, rel string, w http.ResponseWriter) {
	content, err := fs.ReadFile(root, rel)
	if err != nil {
		http.NotFound(w, nil)
		return
	}
	if contentType := mime.TypeByExtension(path.Ext(rel)); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	_, _ = w.Write(content)
}

func registerProviderProxies(mux *http.ServeMux) {
	targets := map[string]string{
		"/deepseek-proxy/": "https://api.deepseek.com/",
		"/openai-proxy/":   "https://api.openai.com/",
		"/kimi-proxy/":     "https://api.moonshot.cn/",
		"/claude-proxy/":   "https://api.anthropic.com/",
		"/nvidia-proxy/":   "https://integrate.api.nvidia.com/",
		"/doubao-proxy/":   "https://ark.cn-beijing.volces.com/",
		"/agnes-proxy/":    "https://apihub.agnes-ai.com/",
	}
	for prefix, target := range targets {
		mux.Handle(prefix, newProxy(prefix, target))
	}
}

func newProxy(prefix string, targetRaw string) http.Handler {
	target, err := url.Parse(targetRaw)
	if err != nil {
		panic(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Director = func(req *http.Request) {
		trimmed := strings.TrimPrefix(req.URL.Path, strings.TrimSuffix(prefix, "/"))
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		req.URL.Path = joinURLPath(target.Path, trimmed)
		req.Host = target.Host
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("[proxy] %s %s failed: %v", r.Method, r.URL.Path, err)
		http.Error(w, "AI proxy request failed: "+err.Error(), http.StatusBadGateway)
	}
	return proxy
}

func joinURLPath(a string, b string) string {
	aslash := strings.HasSuffix(a, "/")
	bslash := strings.HasPrefix(b, "/")
	switch {
	case aslash && bslash:
		return a + b[1:]
	case !aslash && !bslash:
		return a + "/" + b
	default:
		return a + b
	}
}

func openBrowser(rawURL string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", rawURL)
	case "darwin":
		cmd = exec.Command("open", rawURL)
	default:
		cmd = exec.Command("xdg-open", rawURL)
	}
	return cmd.Start()
}

func fatal(message string, err error) {
	fmt.Fprintln(os.Stderr, message+":", err)
	waitBeforeExit()
	os.Exit(1)
}

func waitBeforeExit() {
	if runtime.GOOS != "windows" {
		return
	}
	fmt.Println()
	fmt.Println("按回车键关闭窗口...")
	_, _ = fmt.Scanln()
}
