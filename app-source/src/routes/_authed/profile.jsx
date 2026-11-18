import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Camera, ChevronLeft, MapPin, Phone, Save, UserRound } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/cloudflareClient";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/AuthContext";
import { prepareBillFile } from "@/lib/billFile";

export const Route = createFileRoute("/_authed/profile")({
  head: () => ({ meta: [{ title: "My Profile · Shopping Hisab" }] }),
  component: ProfilePage,
});

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;

function initials(name) {
  const parts = String(name || "Shopping User").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("");
}

function ProfilePage() {
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [preferredMarket, setPreferredMarket] = useState("");
  const [photoUri, setPhotoUri] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.display_name || user.full_name || "");
    setPhone(user.phone || "");
    setPreferredMarket(user.preferred_market || "");
    setPhotoUri(user.profile_picture_uri || "");
  }, [
    user?.id,
    user?.display_name,
    user?.full_name,
    user?.phone,
    user?.preferred_market,
    user?.profile_picture_uri,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!photoUri) {
      setPhotoUrl("");
      return undefined;
    }
    base44.integrations.Core.CreateFileSignedUrl({ file_uri: photoUri, expires_in: 3600 })
      .then(({ signed_url }) => {
        if (!cancelled) setPhotoUrl(signed_url || "");
      })
      .catch(() => {
        if (!cancelled) setPhotoUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [photoUri]);

  const uploadPhoto = async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    const isImage = String(file.type || "").startsWith("image/") || PHOTO_EXT.test(file.name || "");
    if (!isImage) {
      toast.error("Choose a JPG, PNG, WEBP or HEIC image.");
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      toast.error("Profile photos must be 5 MB or smaller.");
      return;
    }

    setPhotoBusy(true);
    try {
      const prepared = await prepareBillFile(file);
      if (!String(prepared.type || "").startsWith("image/")) {
        throw new Error("This image format could not be prepared. Please choose a JPG or PNG photo.");
      }
      const uploaded = await base44.integrations.Core.UploadPrivateFile({ file: prepared });
      if (!uploaded?.file_uri) throw new Error("The photo upload did not return a file reference.");
      setPhotoUri(uploaded.file_uri);
      const signed = await base44.integrations.Core.CreateFileSignedUrl({
        file_uri: uploaded.file_uri,
        expires_in: 3600,
      });
      setPhotoUrl(signed?.signed_url || "");
      toast.success("Profile photo uploaded. Save your profile to keep it.");
    } catch (error) {
      toast.error(error?.message || "Could not upload your photo. Please try again.");
    } finally {
      setPhotoBusy(false);
    }
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    if (displayName.trim().length > 80) {
      toast.error("Display name must be 80 characters or fewer.");
      return;
    }
    if (phone.trim().length > 24) {
      toast.error("Phone number must be 24 characters or fewer.");
      return;
    }
    if (preferredMarket.trim().length > 80) {
      toast.error("Preferred market must be 80 characters or fewer.");
      return;
    }

    setSaving(true);
    try {
      await base44.auth.updateMe({
        display_name: displayName.trim(),
        phone: phone.trim(),
        preferred_market: preferredMarket.trim(),
        profile_picture_uri: photoUri,
      });
      await refresh();
      toast.success("Profile saved");
    } catch (error) {
      toast.error(error?.message || "Could not save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const profileTitle = displayName.trim() || user?.full_name || "Your profile";

  return (
    <div className="space-y-4 pb-4">
      <button
        type="button"
        onClick={() => navigate({ to: "/" })}
        className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Home
      </button>

      <div className="rounded-[26px] bg-primary px-5 py-5 text-primary-foreground">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white/35 bg-white/15 text-xl font-extrabold">
            {photoUrl ? (
              <img src={photoUrl} alt="Profile" className="h-full w-full object-cover" />
            ) : (
              initials(profileTitle) || <UserRound className="h-7 w-7" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[18px] font-extrabold">{profileTitle}</p>
            <p className="mt-0.5 truncate text-[12px] text-white/70">{user?.email || ""}</p>
            <p className="mt-1 text-[11px] text-white/60">Shopping Hisab account</p>
          </div>
        </div>
      </div>

      <form onSubmit={saveProfile} className="space-y-4 rounded-[24px] border border-border bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[18px] font-extrabold">My profile</h1>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Manage your personal details</p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-2 text-[11.5px] font-bold text-foreground">
            <input
              type="file"
              accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif"
              capture="user"
              onChange={uploadPhoto}
              disabled={photoBusy}
              className="hidden"
            />
            <Camera className="h-4 w-4" />
            {photoBusy ? "Uploading…" : "Photo"}
          </label>
        </div>

        <div>
          <Label htmlFor="profile-display-name" className="micro mb-1.5 block text-muted-foreground">
            Display name
          </Label>
          <Input
            id="profile-display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={80}
            placeholder="Your name"
            className="h-11"
          />
        </div>

        <div>
          <Label htmlFor="profile-email" className="micro mb-1.5 block text-muted-foreground">
            Email address
          </Label>
          <Input
            id="profile-email"
            value={user?.email || ""}
            readOnly
            className="h-11 bg-secondary/50 text-muted-foreground"
          />
          <p className="mt-1 text-[10.5px] text-muted-foreground">Email is managed by your sign-in account.</p>
        </div>

        <div>
          <Label htmlFor="profile-phone" className="micro mb-1.5 flex items-center gap-1.5 text-muted-foreground">
            <Phone className="h-3.5 w-3.5" /> Phone number (optional)
          </Label>
          <Input
            id="profile-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            maxLength={24}
            placeholder="Your mobile number"
            className="h-11"
          />
        </div>

        <div>
          <Label htmlFor="profile-market" className="micro mb-1.5 flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" /> Preferred local market (optional)
          </Label>
          <Input
            id="profile-market"
            value={preferredMarket}
            onChange={(event) => setPreferredMarket(event.target.value)}
            maxLength={80}
            placeholder="e.g. Jagiroad, Morigaon, Assam"
            className="h-11"
          />
          <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
            This can help tailor grocery price estimates to your area.
          </p>
        </div>

        {photoUri ? (
          <button
            type="button"
            onClick={() => {
              setPhotoUri("");
              setPhotoUrl("");
            }}
            className="text-[12px] font-semibold text-destructive underline underline-offset-2"
          >
            Remove profile photo
          </button>
        ) : null}

        <button
          type="submit"
          disabled={saving || photoBusy}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3.5 text-[14px] font-bold text-primary-foreground disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving…" : "Save profile"}
        </button>
      </form>
    </div>
  );
}
