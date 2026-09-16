using FluentValidation.TestHelper;
using UniDipVeri.Application.Features.Auth.Models;
using UniDipVeri.Application.Features.Auth.Validators;

namespace UniDipVeri.Application.Tests.Validators;

public class AuthValidatorsTests
{
    private readonly LoginRequestValidator _loginValidator = new();
    private readonly ResetPasswordRequestValidator _resetValidator = new();
    private readonly ConfirmResetPasswordRequestValidator _confirmValidator = new();
    private readonly ChangePasswordRequestValidator _changeValidator = new();

    #region LoginRequestValidator Tests

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void Login_ShouldHaveError_WhenEmailIsBlank(string? email)
    {
        var model = new LoginRequest(email!, "password");
        var result = _loginValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.Email);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void Login_ShouldHaveError_WhenPasswordIsBlank(string? password)
    {
        var model = new LoginRequest("user@miu.edu", password!);
        var result = _loginValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.Password);
    }

    [Fact]
    public void Login_ShouldPass_WhenCredentialsProvided()
    {
        var model = new LoginRequest("user@miu.edu", "Password123!");
        var result = _loginValidator.TestValidate(model);
        result.ShouldNotHaveAnyValidationErrors();
    }

    #endregion

    #region ResetPasswordRequestValidator Tests

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    [InlineData("invalid-email")]
    public void ResetPassword_ShouldHaveError_WhenEmailIsInvalid(string? email)
    {
        var model = new ResetPasswordRequest(email!);
        var result = _resetValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.Email);
    }

    [Fact]
    public void ResetPassword_ShouldPass_WhenEmailIsValid()
    {
        var model = new ResetPasswordRequest("user@miu.edu");
        var result = _resetValidator.TestValidate(model);
        result.ShouldNotHaveAnyValidationErrors();
    }

    #endregion

    #region ConfirmResetPasswordRequestValidator Tests

    [Theory]
    [InlineData("", "Password123!")]
    [InlineData("   ", "Password123!")]
    public void ConfirmResetPassword_ShouldHaveError_WhenTokenIsBlank(string token, string password)
    {
        var model = new ConfirmResetPasswordRequest(token, password);
        var result = _confirmValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.Token);
    }

    [Theory]
    [InlineData("short1!")] // < 8 chars
    [InlineData("allletters")] // no digit/special
    [InlineData("12345678")] // no letter
    public void ConfirmResetPassword_ShouldHaveError_WhenPasswordComplexityFails(string password)
    {
        var model = new ConfirmResetPasswordRequest("valid-token", password);
        var result = _confirmValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.NewPassword);
    }

    [Fact]
    public void ConfirmResetPassword_ShouldPass_WhenValid()
    {
        var model = new ConfirmResetPasswordRequest("valid-token", "Password123!");
        var result = _confirmValidator.TestValidate(model);
        result.ShouldNotHaveAnyValidationErrors();
    }

    #endregion

    #region ChangePasswordRequestValidator Tests

    [Theory]
    [InlineData("", "Password123!")]
    [InlineData("   ", "Password123!")]
    public void ChangePassword_ShouldHaveError_WhenCurrentPasswordIsBlank(string current, string next)
    {
        var model = new ChangePasswordRequest(current, next);
        var result = _changeValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.CurrentPassword);
    }

    [Theory]
    [InlineData("short1!")] // < 8 chars
    [InlineData("allletters")] // no digit/special
    public void ChangePassword_ShouldHaveError_WhenNewPasswordComplexityFails(string password)
    {
        var model = new ChangePasswordRequest("OldPassword123!", password);
        var result = _changeValidator.TestValidate(model);
        result.ShouldHaveValidationErrorFor(x => x.NewPassword);
    }

    [Fact]
    public void ChangePassword_ShouldPass_WhenValid()
    {
        var model = new ChangePasswordRequest("OldPassword123!", "NewPassword123!");
        var result = _changeValidator.TestValidate(model);
        result.ShouldNotHaveAnyValidationErrors();
    }

    #endregion
}
