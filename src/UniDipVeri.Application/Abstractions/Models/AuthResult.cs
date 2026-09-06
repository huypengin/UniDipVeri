namespace UniDipVeri.Application.Abstractions.Models;

public sealed record AuthUserInfo(
    Guid Id,
    string Email,
    string Role,
    string UserType,
    string? StudentNumber = null);

public sealed record AuthResult(bool IsSuccess, AuthUserInfo? User = null, string? Error = null)
{
    public static AuthResult Success(AuthUserInfo user) => new(true, User: user);
    public static AuthResult Failure(string error) => new(false, Error: error);
}