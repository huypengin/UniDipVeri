namespace UniDipVeri.Domain.Common;

public abstract class BaseEntity : IEquatable<BaseEntity>
{
    public Guid Id { get; protected set; } = Guid.NewGuid();
    public DateTime CreatedAt { get; protected set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; protected set; } = DateTime.UtcNow;

    public bool Equals(BaseEntity? other)
    {
        if (ReferenceEquals(this, other))
            return true;

        if (other is null)
            return false;

        // EF Core Proxy-safe type checking
        if (GetType().IsAssignableFrom(other.GetType()) == false && other.GetType().IsAssignableFrom(GetType()) == false)
            return false;

        return Id == other.Id;
    }

    public override bool Equals(object? obj)
        => (obj is BaseEntity other) && Equals(other);

    public override int GetHashCode() => Id.GetHashCode();

    public static bool operator ==(BaseEntity? left, BaseEntity? right)
        => Equals(left, right);

    public static bool operator !=(BaseEntity? left, BaseEntity? right)
        => !Equals(left, right);
}
