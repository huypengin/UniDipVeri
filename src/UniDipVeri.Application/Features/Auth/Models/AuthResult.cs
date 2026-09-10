using System.Text.Json.Serialization;

namespace UniDipVeri.Application.Features.Auth.Models;

public sealed record AuthUserInfo
{
    public Guid Id { get; init; }
    public string Email { get; init; }
    public string Name { get; init; }
    public IReadOnlyList<string> Roles { get; init; }
    public string UserType { get; init; }
    public string? StudentNumber { get; init; }
    public string SecurityStamp { get; init; }

    [JsonConstructor]
    public AuthUserInfo(
        Guid id,
        string email,
        IReadOnlyList<string>? roles,
        string userType,
        string? name = null,
        string? studentNumber = null,
        string? securityStamp = null)
    {
        Id = id;
        Email = email;
        Name = name ?? string.Empty;
        Roles = roles ?? [];
        UserType = userType;
        StudentNumber = studentNumber;
        SecurityStamp = securityStamp ?? string.Empty;
    }

    public AuthUserInfo(
        Guid id,
        string email,
        string role,
        string userType,
        string? studentNumber = null,
        string? securityStamp = null,
        string? name = null)
        : this(id, email, string.IsNullOrEmpty(role) ? [] : [role], userType, name, studentNumber, securityStamp)
    {
    }

    [JsonIgnore]
    public string Role => Roles.Count > 0 ? Roles[0] : string.Empty;
}

public sealed record AuthResult(bool IsSuccess, AuthUserInfo? User = null, string? Error = null)
{
    public static AuthResult Success(AuthUserInfo user) => new(true, User: user);
    public static AuthResult Failure(string error) => new(false, Error: error);
}
