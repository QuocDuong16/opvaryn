package httpapi

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	apiv1 "github.com/QuocDuong16/opvaryn/api/internal/api/v1"
	"github.com/QuocDuong16/opvaryn/api/internal/domain"
	"github.com/QuocDuong16/opvaryn/api/internal/service"
)

// maxUploadBodyBytes bounds the whole multipart request: the file cap plus room for the
// form framing. The file itself is checked again by the service.
const maxUploadBodyBytes = domain.MaxAttachmentBytes + (1 << 20)

func handleUploadAttachment(attachments *service.Attachments, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}

		// The whole body is capped first; the argument below is only the in-memory
		// threshold before a part spills to a temporary file.
		r.Body = http.MaxBytesReader(w, r.Body, maxUploadBodyBytes)
		// #nosec G120 -- r.Body is already capped by MaxBytesReader with maxUploadBodyBytes.
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			log.Warn("rejected upload", "error", err)
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				fmt.Sprintf("file: must be a multipart upload of at most %d MB",
					domain.MaxAttachmentBytes/(1<<20)))
			return
		}
		defer func() { _ = r.MultipartForm.RemoveAll() }()

		file, header, err := r.FormFile("file")
		if err != nil {
			writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
				"file: is required (multipart field \"file\")")
			return
		}
		defer func() { _ = file.Close() }()

		content, err := io.ReadAll(file)
		if err != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				writeError(w, log, http.StatusBadRequest, codeInvalidRequest,
					fmt.Sprintf("file: must be at most %d MB", domain.MaxAttachmentBytes/(1<<20)))
				return
			}
			log.Error("read upload failed", "error", err)
			writeError(w, log, http.StatusInternalServerError, codeInternal, "unexpected server error")
			return
		}

		created, err := attachments.Upload(r.Context(), domain.NewPrincipal(user),
			strings.TrimSpace(r.URL.Query().Get("objectKey")), header.Filename, content)
		if err != nil {
			writeStoreError(w, log, err, "upload attachment")
			return
		}
		writeJSON(w, log, http.StatusCreated, toAPIAttachment(created))
	}
}

func handleDownloadAttachment(attachments *service.Attachments, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		id, ok := parseUUIDParam(w, log, r, "attachmentId", "attachmentId")
		if !ok {
			return
		}

		attachment, err := attachments.Download(r.Context(), domain.NewPrincipal(user), id)
		if err != nil {
			writeStoreError(w, log, err, "download attachment")
			return
		}

		// Always a download, never a rendered page: stored bytes must not become an
		// executable document in the browser's origin.
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", contentDisposition(attachment.FileName))
		w.Header().Set("Content-Length", strconv.Itoa(len(attachment.Content)))
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "private, no-store")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write(attachment.Content); err != nil {
			log.Error("write attachment failed", "error", err)
		}
	}
}

func handleDeleteAttachment(attachments *service.Attachments, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := requireUser(w, log, r)
		if !ok {
			return
		}
		id, ok := parseUUIDParam(w, log, r, "attachmentId", "attachmentId")
		if !ok {
			return
		}
		if err := attachments.Delete(r.Context(), domain.NewPrincipal(user), id); err != nil {
			writeStoreError(w, log, err, "delete attachment")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// contentDisposition offers an ASCII fallback for old clients and the UTF-8 name for the
// browsers people actually use.
func contentDisposition(name string) string {
	ascii := strings.Map(func(r rune) rune {
		if r > 127 || r == '"' || r == '\\' {
			return '_'
		}
		return r
	}, name)
	return fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`,
		ascii, url.PathEscape(name))
}

func toAPIAttachment(attachment domain.Attachment) apiv1.Attachment {
	return apiv1.Attachment{
		Id:          attachment.ID,
		ObjectKey:   attachment.ObjectKey,
		FileName:    attachment.FileName,
		ContentType: attachment.ContentType,
		Size:        attachment.Size,
		CreatedAt:   attachment.CreatedAt,
	}
}
