using UniDipVeri.Domain.Common;

namespace UniDipVeri.Domain.Entities;

public class PasswordResetToken : BaseEntity
{
    public string Email { get; private set; } = string.Empty;
    public string UserType { get; private set; } = string.Empty;
    public string TokenHash { get; private set; } = string.Empty;
    public DateTime ExpiresAt { get; private set; }
    public DateTime? UsedAt { get; private set; }

    protected PasswordResetToken() { }

    public static PasswordResetToken Create(
        string email,
        string userType,
        string tokenHash,
        TimeSpan lifetime,
        Guid? id = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(email);
        ArgumentException.ThrowIfNullOrWhiteSpace(userType);
        ArgumentException.ThrowIfNullOrWhiteSpace(tokenHash);

        if (lifetime <= TimeSpan.Zero)
        {
            throw new ArgumentException("Token lifetime must be greater than zero.", nameof(lifetime));
        }

        var normalizedType = userType.Trim().ToLowerInvariant();
        if (normalizedType != "staff" && normalizedType != "student")
        {
            throw new ArgumentException("UserType must be either 'staff' or 'student'.", nameof(userType));
        }

        var now = DateTime.UtcNow;
        var token = new PasswordResetToken
        {
            Email = email.Trim().ToLowerInvariant(),
            UserType = normalizedType,
            TokenHash = tokenHash.Trim(),
            ExpiresAt = now.Add(lifetime),
            UsedAt = null,
            CreatedAt = now,
            UpdatedAt = now
        };

        if (id.HasValue && id.Value != Guid.Empty)
        {
            token.Id = id.Value;
        }

        return token;
    }

    public bool IsValid(DateTime? checkTime = null)
    {
        var now = checkTime ?? DateTime.UtcNow;
        return UsedAt is null && ExpiresAt > now;
    }

    public void MarkAsUsed(DateTime? usedTime = null)
    {
        if (UsedAt is not null)
        {
            throw new InvalidOperationException("Token has already been used.");
        }

        var now = usedTime ?? DateTime.UtcNow;
        UsedAt = now;
        UpdatedAt = now;
    }
}
